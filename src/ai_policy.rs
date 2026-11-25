use super::*;
use serde_json::{Value,json};

#[derive(Clone,Serialize)]
pub(super) struct Policy {pub level:String,pub details:HashMap<String,String>}
impl Policy {
 pub fn allows(&self,name:&str)->bool {self.level!="off" && !matches!(self.details.get(name).map(String::as_str),Some("끄기"|"꺼짐"))}
}
pub(super) async fn load(app:&App,user:Uuid,room:Option<Uuid>)->Result<Policy,StatusCode>{
 let (level,settings)=sqlx::query_as::<_,(String,Value)>("SELECT ai_intervention,ai_settings FROM retone_v2.users WHERE id=$1 AND deleted_at IS NULL").bind(user).fetch_optional(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::UNAUTHORIZED)?;
 let mut policy=Policy{level,details:serde_json::from_value(settings.get("details").cloned().unwrap_or(json!({}))).unwrap_or_default()};
 if let Some(room)=room {
  let settings=sqlx::query_scalar::<_,Value>("SELECT ai_settings FROM retone_v2.room_members WHERE room_id=$1 AND user_id=$2").bind(room).bind(user).fetch_optional(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::FORBIDDEN)?;
  if policy.level!="off" {if let Some(mode)=settings["mode"].as_str().filter(|s|matches!(*s,"off"|"light"|"standard"|"careful")){policy.level=mode.into();}}
  for (key,names) in [("attack",vec!["강한 공격 표현"]),("tone",vec!["비꼼·압박 표현"]),("source",vec!["출처 확인 제안"]),("flow",vec!["말맞춤 카드","대화 흐름 요약","대화 흐름 참고","대화 복구 문장"]),("help",vec!["표현 바꾸기","감정 도움 AI"]),("image",vec!["이미지 안전 안내"])] {
   if settings["checks"][key]==false {for name in names {policy.details.insert(name.into(),"끄기".into());}}
  }
 }
 Ok(policy)
}
pub(super) async fn require(app:&App,user:Uuid,room:Option<Uuid>,feature:&str)->Result<Policy,StatusCode>{
 let policy=load(app,user,room).await?;
 if !policy.allows(feature){return Err(StatusCode::CONFLICT);}
 security::limit(app,format!("ai:{user}"),40).await?;Ok(policy)
}
pub(super) async fn get(State(app):State<App>,headers:HeaderMap)->Result<Json<Value>,StatusCode>{
 let user=require_user(&app,&headers).await?;
 let settings=sqlx::query_scalar::<_,Value>("SELECT ai_settings FROM retone_v2.users WHERE id=$1").bind(user).fetch_one(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 let rooms=sqlx::query_as::<_,(Uuid,Value)>("SELECT room_id,ai_settings FROM retone_v2.room_members WHERE user_id=$1").bind(user).fetch_all(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 let policy=load(&app,user,None).await?;
 Ok(Json(json!({"level":policy.level,"settings":settings,"rooms":rooms.into_iter().map(|(id,value)|(id.to_string(),value)).collect::<HashMap<_,_>>()})))
}
#[derive(Deserialize)]pub(super) struct RoomSettings{mode:String,#[serde(default)]checks:HashMap<String,bool>}
pub(super) async fn room(State(app):State<App>,Path(room):Path<Uuid>,headers:HeaderMap,Json(input):Json<RoomSettings>)->Result<StatusCode,StatusCode>{
 let user=require_user(&app,&headers).await?;require_room_member(&app,room,user).await?;
 if !matches!(input.mode.as_str(),"inherit"|"off"|"light"|"standard"|"careful")||input.checks.len()>6{return Err(StatusCode::BAD_REQUEST);}
 sqlx::query("UPDATE retone_v2.room_members SET ai_settings=$1 WHERE room_id=$2 AND user_id=$3").bind(json!({"mode":input.mode,"checks":input.checks})).bind(room).bind(user).execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 Ok(StatusCode::NO_CONTENT)
}
