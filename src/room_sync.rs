use super::*;
use serde_json::json;
#[derive(Deserialize)]pub(super) struct Typing{active:bool}
pub(super) async fn typing(State(app):State<App>,Path(room):Path<Uuid>,headers:HeaderMap,Json(input):Json<Typing>)->Result<StatusCode,StatusCode>{
 let user=require_user(&app,&headers).await?;
 let result=sqlx::query("UPDATE retone_v2.room_members SET typing_until=CASE WHEN $3 THEN NOW()+INTERVAL '6 seconds' ELSE NULL END WHERE room_id=$1 AND user_id=$2").bind(room).bind(user).bind(input.active).execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 if result.rows_affected()==0{return Err(StatusCode::FORBIDDEN);}Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize,Default)]pub(super) struct Cursor{after:Option<i64>}
pub(super) async fn sync(State(app):State<App>,Path(room):Path<Uuid>,Query(query):Query<Cursor>,headers:HeaderMap)->Result<Json<serde_json::Value>,StatusCode>{
 let user=require_user(&app,&headers).await?;require_room_member(&app,room,user).await?;chat::read(&app,room,user).await?;
 let after=query.after.unwrap_or(0).max(0);
 let events=sqlx::query_as::<_,(i64,Uuid,bool)>("SELECT seq,message_id,removed FROM retone_v2.message_events WHERE room_id=$1 AND seq>$2 ORDER BY seq LIMIT 500").bind(room).bind(after).fetch_all(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 let snapshot=query.after.is_none();
 let cursor=if snapshot{sqlx::query_scalar::<_,i64>("SELECT COALESCE(MAX(seq),0) FROM retone_v2.message_events WHERE room_id=$1").bind(room).fetch_one(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?}else{events.last().map(|e|e.0).unwrap_or(after)};
 let messages=if snapshot{chat::load(&app,room,user,None,None,50).await?}else if events.is_empty(){Vec::new()}else{chat::load(&app,room,user,None,Some(events.iter().map(|e|e.1).collect()),500).await?};
 let present=messages.iter().map(|m|m.id.clone()).collect::<std::collections::HashSet<_>>();
 let removed=if snapshot{Vec::new()}else{events.iter().filter(|e|!present.contains(&e.1.to_string())).map(|e|e.1.to_string()).collect::<Vec<_>>()};
 let typing=sqlx::query_scalar::<_,String>("SELECT u.name FROM retone_v2.room_members m JOIN retone_v2.users u ON u.id=m.user_id WHERE m.room_id=$1 AND m.user_id<>$2 AND m.typing_until>NOW() ORDER BY u.name,u.id").bind(room).bind(user).fetch_all(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 let receipts=sqlx::query_as::<_,(Uuid,i64)>("SELECT m.id,(SELECT COUNT(*) FROM retone_v2.room_members rm WHERE rm.room_id=m.room_id AND rm.user_id<>$2 AND (rm.last_read_at IS NULL OR rm.last_read_at<m.created_at)) FROM retone_v2.messages m WHERE m.room_id=$1 AND m.sender_id=$2 AND m.deleted_at IS NULL ORDER BY m.created_at DESC,m.id DESC LIMIT 100").bind(room).bind(user).fetch_all(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 let policy=ai_policy::load(&app,user,Some(room)).await?;
 let data=app.data.read().await;let room=room.to_string();
 Ok(Json(json!({"messages":messages,"removed":removed,"cursor":cursor,"snapshot":snapshot,"typing":typing,
  "receipts":receipts.into_iter().map(|(id,count)|(id.to_string(),count.min(255))).collect::<HashMap<_,_>>(),"ai_policy":policy,
  "appointments":data.appointments.iter().filter(|a|a.room_id==room).collect::<Vec<_>>(),"agreements":data.agreements.iter().filter(|a|a.room_id==room).collect::<Vec<_>>(),"reflections":data.reflections.iter().filter(|a|a.room_id==room).collect::<Vec<_>>(),"insights":data.insights.iter().filter(|a|a.room_id==room).collect::<Vec<_>>() })))
}

