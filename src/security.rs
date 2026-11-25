use super::*;
use hmac::{Hmac, Mac};
use axum::http::{header, HeaderValue};
use axum::response::{IntoResponse, Response};
use std::time::{Duration, Instant};

#[derive(Default)]
pub(super) struct Window { start: Option<Instant>, count: u32 }
pub(super) type Limits = Arc<tokio::sync::Mutex<HashMap<String, Window>>>;
pub(super) async fn limit(app: &App, key: String, max: u32) -> Result<(),StatusCode> {
    let now=Instant::now(); let mut limits=app.limits.lock().await;
    limits.retain(|_,v|v.start.is_some_and(|t|now.duration_since(t)<Duration::from_secs(60)));
    let window=limits.entry(key).or_default();
    if window.start.is_none() {window.start=Some(now);}
    if window.count>=max {return Err(StatusCode::TOO_MANY_REQUESTS);}
    window.count+=1; Ok(())
}
pub(super) fn phone(phone:&str)->String {
    let key=env::var("RETONE_PHONE_SECRET").expect("RETONE_PHONE_SECRET is required");
    let digits=phone.chars().filter(|c|c.is_ascii_digit()).collect::<String>();
    let mut mac=Hmac::<Sha256>::new_from_slice(key.as_bytes()).unwrap(); mac.update(digits.as_bytes());
    format!("hmac1:{:x}",mac.finalize().into_bytes())
}
pub(super) async fn migrate_phones(db:&PgPool)->Result<(),sqlx::Error> {
    let rows=sqlx::query_as::<_,(Uuid,String)>("SELECT id,phone_hash FROM retone_v2.users WHERE phone_hash LIKE 'phone:%'").fetch_all(db).await?;
    for (id,old) in rows {sqlx::query("UPDATE retone_v2.users SET phone_hash=$1 WHERE id=$2").bind(phone(&old[6..])).bind(id).execute(db).await?;}
    Ok(())
}
fn base32(value:&str)->Option<Vec<u8>> {
    let mut bits=0u32;let mut used=0;let mut out=Vec::new();
    for c in value.bytes().filter(|c|*c!=b'=') {
        let c=c.to_ascii_uppercase();
        let n=match c {b'A'..=b'Z'=>c-b'A',b'2'..=b'7'=>c-b'2'+26,_=>return None};
        bits=(bits<<5)|u32::from(n);used+=5;
        if used>=8 {used-=8;out.push((bits>>used) as u8);bits&=(1<<used)-1;}
    }
    if bits!=0 {return None;} Some(out)
}
pub(super) fn totp(secret:&str, step:i64)->Option<String> {
    let key=base32(secret)?;if key.len()<20 || step<0 {return None;}
    let mut mac=Hmac::<Sha1>::new_from_slice(&key).ok()?;mac.update(&(step as u64).to_be_bytes());
    let bytes=mac.finalize().into_bytes();let offset=(bytes[19]&15)as usize;
    let n=u32::from_be_bytes(bytes[offset..offset+4].try_into().ok()?)&0x7fff_ffff;
    Some(format!("{:06}",n%1_000_000))
}
fn constant_equal(a:&str,b:&str)->bool {
    let a=Sha256::digest(a.as_bytes());let b=Sha256::digest(b.as_bytes());
    a.iter().zip(b.iter()).fold(0u8,|v,(a,b)|v|(a^b))==0
}
fn admin_cookie(token:&str,age:u32)->HeaderValue {
    let secure=if env::var("RETONE_INSECURE_COOKIES").as_deref()==Ok("true"){""}else{"; Secure"};
    HeaderValue::from_str(&format!("retone_admin={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}{secure}")).unwrap()
}
pub(super) async fn require_admin(app:&App,headers:&HeaderMap)->Result<(),StatusCode> {
    let raw=headers.get(header::COOKIE).and_then(|v|v.to_str().ok()).and_then(|s|s.split(';').find_map(|s|s.trim().strip_prefix("retone_admin="))).ok_or(StatusCode::UNAUTHORIZED)?;
    let token=Uuid::parse_str(raw).map_err(|_|StatusCode::UNAUTHORIZED)?;
    let hash=format!("{:x}",Sha256::digest(token.as_bytes()));
    let valid=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM retone_v2.admin_sessions WHERE token_hash=$1 AND expires_at>NOW())").bind(hash).fetch_one(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    if valid {Ok(())}else{Err(StatusCode::UNAUTHORIZED)}
}
pub(super) async fn verify(app:&App,input:&AdminLogin,allow_setup:bool)->Result<Option<serde_json::Value>,StatusCode> {
    limit(app,"admin-login".into(),15).await?;
    let password=env::var("RETONE_ADMIN_PASSWORD").ok().filter(|v|v.len()>=16).ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let secret=env::var("RETONE_ADMIN_TOTP_SECRET").map_err(|_|StatusCode::SERVICE_UNAVAILABLE)?;
    if totp(&secret,0).is_none(){return Err(StatusCode::SERVICE_UNAVAILABLE);}
    let mut tx=app.db.begin().await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    let (enabled,last,blocked)=sqlx::query_as::<_,(bool,i64,bool)>("SELECT totp_enabled,last_totp_step,COALESCE(blocked_until>NOW(),false) FROM retone_v2.admin_auth_state WHERE id=1 FOR UPDATE").fetch_one(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    if blocked {return Err(StatusCode::TOO_MANY_REQUESTS);}
    let valid_password=constant_equal(&password,&input.password);
    if valid_password && !enabled && input.two_factor.is_empty() && allow_setup {
        tx.commit().await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
        let uri=format!("otpauth://totp/ReTone:admin?secret={secret}&issuer=ReTone&algorithm=SHA1&digits=6&period=30");
        let qr=QrCode::new(uri.as_bytes()).map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.render::<svg::Color>().min_dimensions(220,220).build();
        return Ok(Some(serde_json::json!({"setup_required":true,"qr_svg":qr,"secret":secret})));
    }
    let now=Utc::now().timestamp()/30;
    let step=(now-1..=now+1).find(|step|*step>last && totp(&secret,*step).is_some_and(|code|constant_equal(&code,input.two_factor.trim())));
    if !valid_password || step.is_none() {
        sqlx::query("UPDATE retone_v2.admin_auth_state SET failures=failures+1,blocked_until=CASE WHEN failures>=4 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END WHERE id=1").execute(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
        tx.commit().await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
        return Err(StatusCode::UNAUTHORIZED);
    }
    sqlx::query("UPDATE retone_v2.admin_auth_state SET failures=0,blocked_until=NULL,totp_enabled=TRUE,last_totp_step=$1 WHERE id=1").bind(step.unwrap()).execute(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;Ok(None)
}
pub(super) async fn login(State(app):State<App>,Json(input):Json<AdminLogin>)->Result<Response,StatusCode> {
    let mut response=if let Some(setup)=verify(&app,&input,true).await? {Json(setup).into_response()}else{
        let token=Uuid::new_v4();let hash=format!("{:x}",Sha256::digest(token.as_bytes()));
        sqlx::query("INSERT INTO retone_v2.admin_sessions(token_hash,expires_at) VALUES($1,NOW()+INTERVAL '8 hours')").bind(hash).execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
        let mut out=Json(serde_json::json!({"id":"admin","name":"Re:Tone 관리자","avatar_url":null,"ai_intervention":"off"})).into_response();
        out.headers_mut().insert(header::SET_COOKIE,admin_cookie(&token.to_string(),8*3600));out
    };
    response.headers_mut().insert(header::CACHE_CONTROL,HeaderValue::from_static("no-store"));Ok(response)
}
pub(super) async fn me(State(app):State<App>,headers:HeaderMap)->Result<Json<serde_json::Value>,StatusCode>{
    require_admin(&app,&headers).await?;Ok(Json(serde_json::json!({"id":"admin","name":"Re:Tone 관리자"})))
}
pub(super) async fn logout(State(app):State<App>,headers:HeaderMap)->Result<Response,StatusCode>{
    if let Some(raw)=headers.get(header::COOKIE).and_then(|v|v.to_str().ok()).and_then(|s|s.split(';').find_map(|s|s.trim().strip_prefix("retone_admin="))) {
        if let Ok(token)=Uuid::parse_str(raw){let hash=format!("{:x}",Sha256::digest(token.as_bytes()));sqlx::query("DELETE FROM retone_v2.admin_sessions WHERE token_hash=$1").bind(hash).execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;}
    }
    let mut out=StatusCode::NO_CONTENT.into_response();out.headers_mut().insert(header::SET_COOKIE,admin_cookie("",0));Ok(out)
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn standard_totp_vectors(){let s="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";assert_eq!(totp(s,59/30).unwrap(),"287082");assert_eq!(totp(s,1111111109/30).unwrap(),"081804");assert!(totp("invalid!",1).is_none());}
}
