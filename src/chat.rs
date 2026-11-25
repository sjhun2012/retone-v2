use super::*;
use sqlx::Row;
use serde_json::{json,Value};

#[derive(Deserialize,Default)]pub(super) struct Page{pub before:Option<Uuid>,pub limit:Option<i64>}
pub(super) async fn load(app:&App,room:Uuid,user:Uuid,before:Option<Uuid>,ids:Option<Vec<Uuid>>,limit:i64)->Result<Vec<Message>,StatusCode>{
 let rows=sqlx::query("SELECT m.*,u.name AS sender,FLOOR(EXTRACT(EPOCH FROM m.created_at)*1000)::BIGINT AS created,
  (SELECT COUNT(*) FROM retone_v2.room_members rm WHERE rm.room_id=m.room_id AND rm.user_id<>$2 AND (rm.last_read_at IS NULL OR rm.last_read_at<m.created_at)) AS unread,
  COALESCE((SELECT jsonb_agg(r) FROM(SELECT emoji,COUNT(*) AS count,bool_or(user_id=$2) AS mine FROM retone_v2.message_reactions WHERE message_id=m.id GROUP BY emoji ORDER BY emoji)r),'[]'::jsonb) AS reactions
  FROM retone_v2.messages m LEFT JOIN retone_v2.users u ON u.id=m.sender_id
  WHERE m.room_id=$1 AND m.deleted_at IS NULL
  AND ($3::uuid IS NULL OR (m.created_at,m.id)<(SELECT created_at,id FROM retone_v2.messages WHERE id=$3 AND room_id=$1))
  AND ($4::uuid[] IS NULL OR m.id=ANY($4)) ORDER BY m.created_at DESC,m.id DESC LIMIT $5")
  .bind(room).bind(user).bind(before).bind(ids).bind(limit.clamp(1,500)).fetch_all(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 let mut messages=Vec::new();
 for row in rows {
  let id:Uuid=row.try_get("id").map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
  let sender:Option<Uuid>=row.get("sender_id");let mine=sender==Some(user);
  messages.push(Message{id:id.to_string(),room_id:room.to_string(),sender:row.get::<Option<String>,_>("sender").unwrap_or_else(||"탈퇴한 사용자".into()),sender_id:sender.map(|id|id.to_string()),mine,
   body:row.get("body"),created:row.get("created"),unread:if mine{row.get::<i64,_>("unread").clamp(0,255)as u8}else{0},intent:row.get("intent"),image_url:row.get("image_url"),reply_to:row.get::<Option<Uuid>,_>("reply_to").map(|id|id.to_string()),
   alignment_hint:mine&&row.get("alignment_hint"),alignment_kind:if mine{row.get("alignment_kind")}else{None},alignment_summary:if mine{row.get("alignment_summary")}else{None},
   ai_verdict:if mine{row.get("ai_verdict")}else{None},ai_suggestion:if mine{row.get("ai_suggestion")}else{None},ai_trigger:if mine{row.get("ai_trigger")}else{None},reactions:row.get("reactions")});
 }
 messages.reverse();Ok(messages)
}
pub(super) async fn read(app:&App,room:Uuid,user:Uuid)->Result<(),StatusCode>{
 sqlx::query("UPDATE retone_v2.room_members SET last_read_at=NOW() WHERE room_id=$1 AND user_id=$2").bind(room).bind(user).execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;Ok(())
}
pub(super) async fn messages(State(app):State<App>,Path(room):Path<Uuid>,Query(page):Query<Page>,headers:HeaderMap)->Result<Json<Vec<Message>>,StatusCode>{
 let user=require_user(&app,&headers).await?;require_room_member(&app,room,user).await?;read(&app,room,user).await?;
 Ok(Json(load(&app,room,user,page.before,None,page.limit.unwrap_or(50).clamp(1,100)).await?))
}
#[derive(Deserialize)]pub(super) struct Reaction{emoji:String,active:bool}
pub(super) async fn react(State(app):State<App>,Path((room,message)):Path<(Uuid,Uuid)>,headers:HeaderMap,Json(input):Json<Reaction>)->Result<Json<Value>,StatusCode>{
 let user=require_user(&app,&headers).await?;require_room_member(&app,room,user).await?;
 security::limit(&app,format!("react:{user}"),60).await?;
 if !matches!(input.emoji.as_str(),"👍"|"❤️"|"😂"|"👏"|"✅"){return Err(StatusCode::BAD_REQUEST);}
 let exists=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM retone_v2.messages WHERE id=$1 AND room_id=$2 AND deleted_at IS NULL)").bind(message).bind(room).fetch_one(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 if !exists{return Err(StatusCode::NOT_FOUND);}
 if input.active {sqlx::query("INSERT INTO retone_v2.message_reactions(message_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT DO NOTHING").bind(message).bind(user).bind(input.emoji).execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;}
 else {sqlx::query("DELETE FROM retone_v2.message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3").bind(message).bind(user).bind(input.emoji).execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;}
 let message=load(&app,room,user,None,Some(vec![message]),1).await?.into_iter().next().ok_or(StatusCode::NOT_FOUND)?;
 Ok(Json(json!({"id":message.id,"reactions":message.reactions})))
}
pub(super) fn trim_cache(data:&mut Data,room:&str){let mut count=0;let mut keep=std::collections::HashSet::new();for message in data.messages.iter().rev().filter(|m|m.room_id==room){if count>=100{break;}keep.insert(message.id.clone());count+=1;}data.messages.retain(|m|m.room_id!=room||keep.contains(&m.id));}
