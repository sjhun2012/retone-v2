use super::*;
use base64::{Engine,engine::general_purpose::STANDARD};
use axum::response::{IntoResponse,Response};
use axum::http::{header,HeaderValue};
fn decode(data:&str)->Result<(String,Vec<u8>),StatusCode>{
 let (prefix,body)=data.split_once(',').ok_or(StatusCode::BAD_REQUEST)?;
 let mime=prefix.strip_prefix("data:").and_then(|s|s.strip_suffix(";base64")).ok_or(StatusCode::BAD_REQUEST)?;
 let bytes=STANDARD.decode(body).map_err(|_|StatusCode::BAD_REQUEST)?;
 if bytes.len()>2_000_000{return Err(StatusCode::PAYLOAD_TOO_LARGE);}
 let valid=match mime{"image/png"=>bytes.starts_with(b"\x89PNG\r\n\x1a\n"),"image/jpeg"=>bytes.starts_with(b"\xff\xd8\xff"),"image/webp"=>bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"WEBP"),_=>false};
 if !valid{return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);}Ok((mime.into(),bytes))
}
pub(super) async fn upload(app:&App,user:Uuid,room:Option<Uuid>,data:&str,folder:&str)->Result<String,StatusCode>{
 let (mime,bytes)=decode(data)?;security::limit(app,format!("upload:{user}"),10).await?;
 if ["CLOUDINARY_CLOUD_NAME","CLOUDINARY_API_KEY","CLOUDINARY_API_SECRET"].iter().all(|key|env::var(key).is_ok_and(|value|!value.trim().is_empty())){return upload_to_cloudinary(data,folder).await;}
 let mut tx=app.db.begin().await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 sqlx::query("SELECT id FROM retone_v2.users WHERE id=$1 FOR UPDATE").bind(user).fetch_one(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 let count=sqlx::query_scalar::<_,i64>("SELECT COALESCE(SUM(octet_length(bytes)),0)::BIGINT FROM retone_v2.media WHERE owner_id=$1").bind(user).fetch_one(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 if count+bytes.len()as i64>30_000_000{return Err(StatusCode::PAYLOAD_TOO_LARGE);}
 let id=Uuid::new_v4();sqlx::query("INSERT INTO retone_v2.media(id,owner_id,room_id,mime,bytes) VALUES($1,$2,$3,$4,$5)").bind(id).bind(user).bind(room).bind(mime).bind(bytes).execute(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 tx.commit().await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
 Ok(format!("/api/media/{id}"))
}
pub(super) async fn get(State(app):State<App>,Path(id):Path<Uuid>,headers:HeaderMap)->Result<Response,StatusCode>{
 let user=require_user(&app,&headers).await?;
 let (owner,room,mime,bytes)=sqlx::query_as::<_,(Uuid,Option<Uuid>,String,Vec<u8>)>("SELECT owner_id,room_id,mime,bytes FROM retone_v2.media WHERE id=$1").bind(id).fetch_optional(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::NOT_FOUND)?;
 if let Some(room)=room{require_room_member(&app,room,user).await?;
  let attached=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM retone_v2.messages WHERE room_id=$1 AND image_url=$2 AND deleted_at IS NULL)").bind(room).bind(format!("/api/media/{id}")).fetch_one(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
  if !attached{return Err(StatusCode::NOT_FOUND);}
 }
 else if owner!=user{
  let valid=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM retone_v2.friendships WHERE user_id=$1 AND friend_id=$2 UNION ALL SELECT 1 FROM retone_v2.room_members a JOIN retone_v2.room_members b ON a.room_id=b.room_id WHERE a.user_id=$1 AND b.user_id=$2)").bind(user).bind(owner).fetch_one(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
  if !valid{return Err(StatusCode::FORBIDDEN);}
 }
 let mut out=bytes.into_response();out.headers_mut().insert(header::CONTENT_TYPE,HeaderValue::from_str(&mime).unwrap());out.headers_mut().insert(header::CACHE_CONTROL,HeaderValue::from_static("private, no-store"));out.headers_mut().insert("X-Content-Type-Options",HeaderValue::from_static("nosniff"));Ok(out)
}
