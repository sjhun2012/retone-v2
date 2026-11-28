use axum::{Json,extract::{State,Path},http::{HeaderMap,StatusCode}};
use base64::{Engine,engine::general_purpose::{STANDARD,URL_SAFE_NO_PAD}};
use ring::{rand::SystemRandom,signature::{RsaKeyPair,RSA_PKCS1_SHA256,KeyPair}};
use serde::Deserialize;
use sqlx::{PgPool,Postgres,Transaction};
use std::{sync::OnceLock,time::{Duration,SystemTime,UNIX_EPOCH}};
use tokio::sync::Mutex;
use uuid::Uuid;
use crate::{App,require_user,session};

const PROJECT:&str="retone-push-sjhun-20261128";
const ORIGIN:&str="https://retone-v2-mygr.onrender.com";
static SENDER:OnceLock<Sender>=OnceLock::new();
static SIGNAL:tokio::sync::Notify=tokio::sync::Notify::const_new();
pub fn wake(){SIGNAL.notify_one();}
struct Sender{key:RsaKeyPair,email:String,client:reqwest::Client,access:Mutex<Option<(String,u64)>>,oauth_url:String,fcm_url:String}
#[derive(Deserialize)]
struct Credential{project_id:String,client_email:String,private_key:String,#[serde(rename="type")]kind:String}
#[derive(Deserialize)]
pub struct Device{installation_id:Uuid,platform:String,token:String}
#[derive(Deserialize)]
pub struct Refresh{token:String}
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()}
fn credential(value:&str)->Result<(Credential,RsaKeyPair),&'static str>{
    let config:Credential=serde_json::from_str(value).map_err(|_|"invalid service-account JSON")?;
    if config.kind!="service_account"||config.project_id!=PROJECT||!config.client_email.ends_with(".iam.gserviceaccount.com"){return Err("service-account project does not match Re:tone");}
    let pem=config.private_key.trim();
    if !pem.starts_with("-----BEGIN PRIVATE KEY-----")||!pem.ends_with("-----END PRIVATE KEY-----"){return Err("a PKCS8 service-account private key is required");}
    let encoded=pem.lines().filter(|line|!line.starts_with("-----")).collect::<String>();
    let der=STANDARD.decode(encoded).map_err(|_|"invalid private-key encoding")?;
    let key=RsaKeyPair::from_pkcs8(&der).map_err(|_|"invalid RSA service-account private key")?;
    Ok((config,key))
}
fn valid_token(token:&str)->bool{(20..=4096).contains(&token.len())&&token.bytes().all(|c|c.is_ascii_alphanumeric()||b"_:.-".contains(&c))}

pub async fn config()->Json<serde_json::Value>{
    let raw=std::env::var("RETONE_FIREBASE_VAPID_PUBLIC_KEY").unwrap_or_default();
    let public=URL_SAFE_NO_PAD.decode(&raw).ok().is_some_and(|bytes|bytes.len()==65&&bytes[0]==4);
    Json(serde_json::json!({"enabled":SENDER.get().is_some(),"project_id":PROJECT,"vapid_key":if public{raw}else{String::new()},"android_version_code":3}))
}
pub async fn refresh(State(app):State<App>,Path(id):Path<Uuid>,headers:HeaderMap,Json(input):Json<Refresh>)->Result<StatusCode,StatusCode>{
    let user=require_user(&app,&headers).await?;let session=session::token(&headers)?;
    if !valid_token(&input.token){return Err(StatusCode::BAD_REQUEST);}
    // Background token rotation can update only its existing session binding;
    // it must not take an installation back from a newer signed-in account.
    let changed=sqlx::query("UPDATE retone_v2.push_devices SET token=$4,updated_at=NOW() WHERE id=$1 AND user_id=$2 AND session_token=$3 AND platform='android'")
        .bind(id).bind(user).bind(session).bind(input.token).execute(&app.db).await.map_err(|_|StatusCode::CONFLICT)?.rows_affected();
    if changed==0{return Err(StatusCode::CONFLICT);}Ok(StatusCode::NO_CONTENT)
}
pub async fn register(State(app):State<App>,headers:HeaderMap,Json(input):Json<Device>)->Result<Json<serde_json::Value>,StatusCode>{
    let user=require_user(&app,&headers).await?;
    let session=session::token(&headers)?;
    if !matches!(input.platform.as_str(),"android"|"web")||!valid_token(&input.token){return Err(StatusCode::BAD_REQUEST);}
    let mut tx=app.db.begin().await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,98765))").bind(input.installation_id.to_string()).execute(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    // Rebinding an installation/session removes its previous recipient's queued
    // messages through the foreign key. Tokens never appear in responses/logs.
    sqlx::query("DELETE FROM retone_v2.push_devices WHERE (token=$1 AND id<>$2) OR (id=$2 AND (user_id<>$3 OR session_token<>$4 OR token<>$1 OR platform<>$5))")
        .bind(&input.token).bind(input.installation_id).bind(user).bind(session).bind(&input.platform).execute(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("INSERT INTO retone_v2.push_devices(id,user_id,session_token,platform,token) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET updated_at=NOW()")
        .bind(input.installation_id).bind(user).bind(session).bind(&input.platform).bind(&input.token).execute(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("DELETE FROM retone_v2.push_devices WHERE id IN(SELECT id FROM retone_v2.push_devices WHERE user_id=$1 ORDER BY updated_at DESC,id OFFSET 20)")
        .bind(user).execute(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({"registered":true,"delivery_enabled":SENDER.get().is_some(),"user_id":user,"installation_id":input.installation_id})))
}
pub async fn remove(State(app):State<App>,Path(id):Path<Uuid>,headers:HeaderMap)->Result<StatusCode,StatusCode>{
    let user=require_user(&app,&headers).await?;let token=session::token(&headers)?;
    sqlx::query("DELETE FROM retone_v2.push_devices WHERE id=$1 AND user_id=$2 AND session_token=$3")
        .bind(id).bind(user).bind(token).execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn status(State(app):State<App>,headers:HeaderMap)->Result<Json<serde_json::Value>,StatusCode>{
    let user=require_user(&app,&headers).await?;let token=session::token(&headers)?;
    let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM retone_v2.push_devices WHERE user_id=$1 AND session_token=$2").bind(user).bind(token).fetch_one(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({"registered_devices":count,"delivery_enabled":SENDER.get().is_some()})))
}
pub async fn enqueue(tx:&mut Transaction<'_,Postgres>,notice:i64,user:Uuid)->Result<(),StatusCode>{
    sqlx::query("INSERT INTO retone_v2.push_jobs(notification_id,device_id) SELECT $1,d.id FROM retone_v2.push_devices d JOIN retone_v2.auth_sessions s ON s.token=d.session_token WHERE d.user_id=$2 AND s.expires_at>NOW() AND NOT EXISTS(SELECT 1 FROM retone_v2.user_notifications n JOIN retone_v2.room_members rm ON rm.room_id=n.room_id AND rm.user_id=n.recipient_id WHERE n.id=$1 AND rm.notifications_muted) ON CONFLICT DO NOTHING")
        .bind(notice).bind(user).execute(&mut **tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(())
}

impl Sender{
    fn assertion(&self,timestamp:u64)->Result<String,()>{
        let header=URL_SAFE_NO_PAD.encode(br#"{"alg":"RS256","typ":"JWT"}"#);
        let claims=URL_SAFE_NO_PAD.encode(serde_json::to_vec(&serde_json::json!({"iss":self.email,"scope":"https://www.googleapis.com/auth/firebase.messaging","aud":"https://oauth2.googleapis.com/token","iat":timestamp,"exp":timestamp+3600})).map_err(|_|())?);
        let input=format!("{header}.{claims}");let mut signature=vec![0;self.key.public().modulus_len()];
        self.key.sign(&RSA_PKCS1_SHA256,&SystemRandom::new(),input.as_bytes(),&mut signature).map_err(|_|())?;
        Ok(format!("{input}.{}",URL_SAFE_NO_PAD.encode(signature)))
    }
    async fn access_token(&self)->Result<String,()>{
        let mut cached=self.access.lock().await;let timestamp=now();
        if let Some((token,expires))=&*cached{if *expires>timestamp+60{return Ok(token.clone());}}
        let assertion=self.assertion(timestamp)?;
        let response=self.client.post(&self.oauth_url).header("Content-Type","application/x-www-form-urlencoded")
            .body(format!("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion={assertion}")).send().await.map_err(|_|())?;
        if !response.status().is_success(){return Err(());}
        let value:serde_json::Value=response.json().await.map_err(|_|())?;
        let token=value["access_token"].as_str().ok_or(())?.to_string();
        let duration=value["expires_in"].as_u64().unwrap_or(3600).min(3600);
        *cached=Some((token.clone(),timestamp+duration));Ok(token)
    }
    async fn send(&self,token:&str,platform:&str,id:i64,user:Uuid,title:&str,body:&str)->Delivery{
        let access=match self.access_token().await{Ok(value)=>value,Err(_)=>return Delivery::Retry(60)};
        let data=serde_json::json!({"notice_id":id.to_string(),"user_id":user.to_string(),"title":title,"body":body});
        let mut message=serde_json::json!({"token":token,"data":data});
        if platform=="android"{message["android"]=serde_json::json!({"priority":"HIGH","ttl":"86400s"});}
        else{message["webpush"]=serde_json::json!({"headers":{"TTL":"86400","Urgency":"high"},"fcm_options":{"link":format!("{ORIGIN}/?notice={id}")}});}
        let response=match self.client.post(&self.fcm_url).bearer_auth(access).json(&serde_json::json!({"message":message})).send().await{Ok(value)=>value,Err(_)=>return Delivery::Retry(30)};
        let status=response.status();if status.is_success(){return Delivery::Sent;}
        let retry=response.headers().get("retry-after").and_then(|h|h.to_str().ok()).and_then(|h|h.parse::<u64>().ok()).unwrap_or(60).clamp(5,3600);
        if status.as_u16()==401{*self.access.lock().await=None;return Delivery::Retry(retry);}
        let value:serde_json::Value=response.json().await.unwrap_or_default();
        let unregistered=value["error"]["details"].as_array().is_some_and(|items|items.iter().any(|item|item["@type"]=="type.googleapis.com/google.firebase.fcm.v1.FcmError"&&item["errorCode"]=="UNREGISTERED"));
        if unregistered{return Delivery::Invalid;}
        if status.as_u16()==429||status.as_u16()==403||status.is_server_error(){Delivery::Retry(retry)}else{Delivery::Failed}
    }
}
enum Delivery{Sent,Invalid,Retry(u64),Failed}

pub fn start(db:PgPool){
    let Ok(raw)=std::env::var("RETONE_FCM_SERVICE_ACCOUNT_JSON") else{return;};
    let (credentials,key)=match credential(&raw){Ok(value)=>value,Err(reason)=>{eprintln!("FCM disabled: {reason}");return;}};
    #[allow(unused_mut)]
    let mut endpoints=("https://oauth2.googleapis.com/token".to_string(),format!("https://fcm.googleapis.com/v1/projects/{PROJECT}/messages:send"));
    // Only debug builds used in isolated CI can contact the local mock. Release
    // builds do not read this variable and always use Google's fixed endpoints.
    #[cfg(debug_assertions)]
    if let Ok(origin)=std::env::var("RETONE_FCM_TEST_ORIGIN"){
        let parsed=reqwest::Url::parse(&origin).expect("local FCM test origin");
        assert!(parsed.scheme()=="http"&&parsed.host_str()==Some("127.0.0.1")&&parsed.port().is_some()&&parsed.path()=="/"&&parsed.query().is_none()&&parsed.username().is_empty()&&parsed.password().is_none());
        let base=origin.trim_end_matches('/');endpoints=(format!("{base}/token"),format!("{base}/messages"));
    }
    let sender=Sender{key,email:credentials.client_email,client:reqwest::Client::builder().timeout(Duration::from_secs(15)).build().expect("FCM HTTP client"),access:Mutex::new(None),oauth_url:endpoints.0,fcm_url:endpoints.1};
    if SENDER.set(sender).is_err(){return;}
    tokio::spawn(async move{
        let mut cleaned=0;
        loop{
            if now().saturating_sub(cleaned)>3600{
                let _=sqlx::query("DELETE FROM retone_v2.push_devices d WHERE NOT EXISTS(SELECT 1 FROM retone_v2.auth_sessions s WHERE s.token=d.session_token AND s.expires_at>NOW())").execute(&db).await;
                let _=sqlx::query("DELETE FROM retone_v2.push_jobs WHERE completed_at<NOW()-INTERVAL '7 days'").execute(&db).await;
                cleaned=now();
            }
            match dispatch_one(&db).await{
                Ok(true)=>{},
                Ok(false)=>{
                    let due=sqlx::query_scalar::<_,Option<chrono::DateTime<chrono::Utc>>>("SELECT MIN(GREATEST(next_attempt,COALESCE(locked_until,next_attempt))) FROM retone_v2.push_jobs WHERE completed_at IS NULL").fetch_one(&db).await.ok().flatten();
                    let wait=due.map(|date|(date.timestamp_millis()-chrono::Utc::now().timestamp_millis()).clamp(1000,600000) as u64).unwrap_or(600000);
                    tokio::select!{_=SIGNAL.notified()=>{},_=tokio::time::sleep(Duration::from_millis(wait))=>{}}
                },
                Err(_)=>{eprintln!("FCM queue temporarily unavailable");tokio::time::sleep(Duration::from_secs(10)).await;}
            }
        }
    });
}
async fn dispatch_one(db:&PgPool)->Result<bool,sqlx::Error>{
    let claimed=sqlx::query_as::<_,(i64,Uuid,i32)>("UPDATE retone_v2.push_jobs SET locked_until=NOW()+INTERVAL '60 seconds',attempts=attempts+1 WHERE (notification_id,device_id) IN(SELECT notification_id,device_id FROM retone_v2.push_jobs WHERE completed_at IS NULL AND next_attempt<=NOW() AND (locked_until IS NULL OR locked_until<NOW()) ORDER BY next_attempt,notification_id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING notification_id,device_id,attempts")
        .fetch_optional(db).await?;
    let Some((id,device,attempts))=claimed else{return Ok(false);};
    let record=sqlx::query_as::<_,(String,String,Uuid,String,String)>("SELECT d.token,d.platform,d.user_id,n.title,n.body FROM retone_v2.push_devices d JOIN retone_v2.auth_sessions s ON s.token=d.session_token JOIN retone_v2.users u ON u.id=d.user_id JOIN retone_v2.user_notifications n ON n.id=$1 AND n.recipient_id=d.user_id WHERE d.id=$2 AND EXISTS(SELECT 1 FROM retone_v2.push_jobs j WHERE j.notification_id=n.id AND j.device_id=d.id AND j.completed_at IS NULL) AND s.user_id=d.user_id AND s.expires_at>NOW() AND u.deleted_at IS NULL AND n.read_at IS NULL AND n.created_at>NOW()-INTERVAL '24 hours' AND NOT EXISTS(SELECT 1 FROM retone_v2.room_members rm WHERE rm.room_id=n.room_id AND rm.user_id=n.recipient_id AND rm.notifications_muted) AND NOT EXISTS(SELECT 1 FROM retone_v2.blocks b WHERE (b.blocker_id=d.user_id AND b.blocked_id=n.actor_id) OR (b.blocker_id=n.actor_id AND b.blocked_id=d.user_id))")
        .bind(id).bind(device).fetch_optional(db).await?;
    let delivery=if let Some((token,platform,user,title,body))=record{SENDER.get().expect("FCM sender").send(&token,&platform,id,user,&title,&body).await}else{Delivery::Failed};
    match delivery{
        Delivery::Invalid=>{sqlx::query("DELETE FROM retone_v2.push_devices WHERE id=$1").bind(device).execute(db).await?;},
        Delivery::Retry(delay) if attempts<8=>{
            let seconds=(delay.max(5*2u64.pow(attempts.min(9) as u32))).min(3600) as i64;
            sqlx::query("UPDATE retone_v2.push_jobs SET locked_until=NULL,next_attempt=NOW()+($3::BIGINT*INTERVAL '1 second'),outcome='retry' WHERE notification_id=$1 AND device_id=$2")
                .bind(id).bind(device).bind(seconds).execute(db).await?;
        },
        result=>{
            let outcome=if matches!(result,Delivery::Sent){"sent"}else{"not-delivered"};
            sqlx::query("UPDATE retone_v2.push_jobs SET completed_at=NOW(),locked_until=NULL,outcome=$3 WHERE notification_id=$1 AND device_id=$2").bind(id).bind(device).bind(outcome).execute(db).await?;
        },
    }
    Ok(true)
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn tokens_are_bounded_and_cannot_inject_headers(){assert!(valid_token(&"a".repeat(40)));for value in ["short","a\r\nb","https://evil.test/token"]{assert!(!valid_token(value));}assert!(!valid_token(&"a".repeat(4097)));}
    #[test]fn invalid_credentials_never_enable_delivery(){assert!(credential("{}").is_err());assert!(credential(r#"{"type":"service_account","project_id":"wrong","client_email":"a@wrong.iam.gserviceaccount.com","private_key":"secret"}"#).is_err());}
    #[test]fn oauth_assertion_has_valid_signature_scope_and_expiry(){
        let generated=std::process::Command::new("openssl").args(["genpkey","-algorithm","RSA","-pkeyopt","rsa_keygen_bits:2048"]).output().expect("OpenSSL test key generation");
        assert!(generated.status.success());
        let value=serde_json::json!({"type":"service_account","project_id":PROJECT,"client_email":format!("test@{PROJECT}.iam.gserviceaccount.com"),"private_key":String::from_utf8(generated.stdout).unwrap()});
        let (config,key)=credential(&value.to_string()).unwrap();
        let sender=Sender{key,email:config.client_email,client:reqwest::Client::new(),access:Mutex::new(None),oauth_url:String::new(),fcm_url:String::new()};
        let jwt=sender.assertion(10000).unwrap();let parts:Vec<_>=jwt.split('.').collect();assert_eq!(parts.len(),3);
        let claims:serde_json::Value=serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["exp"],13600);assert_eq!(claims["aud"],"https://oauth2.googleapis.com/token");assert_eq!(claims["scope"],"https://www.googleapis.com/auth/firebase.messaging");
        ring::signature::UnparsedPublicKey::new(&ring::signature::RSA_PKCS1_2048_8192_SHA256,sender.key.public().as_ref()).verify(format!("{}.{}",parts[0],parts[1]).as_bytes(),&URL_SAFE_NO_PAD.decode(parts[2]).unwrap()).unwrap();
    }
}
