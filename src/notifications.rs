use axum::{Json,extract::{State,Query,Path},http::{HeaderMap,StatusCode}};
use serde::{Deserialize,Serialize};
use sqlx::{Postgres,Transaction};
use uuid::Uuid;
use crate::{App,require_user};

#[derive(Serialize)]
pub struct Notice{pub id:i64,pub kind:String,pub title:String,pub body:String,pub room_id:Option<Uuid>,pub created:i64,pub read:bool,pub muted:bool}
#[derive(Deserialize)]
pub struct Cursor{pub since:Option<i64>}
#[derive(Deserialize)]
pub struct Read{#[serde(default)]pub ids:Vec<i64>,#[serde(default)]pub all:bool}

pub async fn insert(transaction:&mut Transaction<'_,Postgres>,recipient:Uuid,actor:Uuid,kind:&str,room:Option<Uuid>)->Result<(),StatusCode>{
    if recipient==actor{return Ok(());}
    // Hold through commit so feed cursors cannot jump past a slower uncommitted event.
    sqlx::query("SELECT pg_advisory_xact_lock(231247117930202)").execute(&mut **transaction).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    let actor_name:String=sqlx::query_scalar("SELECT name FROM retone_v2.users WHERE id=$1 AND deleted_at IS NULL")
        .bind(actor).fetch_one(&mut **transaction).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    let (title,body)=match kind{
        "friend_request"=>("새 친구 요청".to_string(),format!("{actor_name}님이 친구 요청을 보냈어요.")),
        "friend_accepted"=>("친구 요청 수락".to_string(),format!("{actor_name}님이 친구 요청을 수락했어요.")),
        "room_invite"=>{
            let name:String=sqlx::query_scalar("SELECT name FROM retone_v2.rooms WHERE id=$1").bind(room.ok_or(StatusCode::BAD_REQUEST)?)
                .fetch_one(&mut **transaction).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
            ("채팅방 초대".to_string(),format!("{actor_name}님이 ‘{name}’ 채팅방에 초대했어요."))
        },
        _=>return Err(StatusCode::BAD_REQUEST),
    };
    let id:i64=sqlx::query_scalar("INSERT INTO retone_v2.user_notifications(recipient_id,actor_id,kind,title,body,room_id,alerts_suppressed) VALUES($1,$2,$3,$4,$5,$6,EXISTS(SELECT 1 FROM retone_v2.room_members rm WHERE rm.room_id=$6 AND rm.user_id=$1 AND rm.notifications_muted)) RETURNING id")
        .bind(recipient).bind(actor).bind(kind).bind(title).bind(body).bind(room).fetch_one(&mut **transaction).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    crate::push::enqueue(transaction,id,recipient).await?;
    Ok(())
}

pub async fn list(State(app):State<App>,headers:HeaderMap,Query(query):Query<Cursor>)->Result<Json<serde_json::Value>,StatusCode>{
    let user=require_user(&app,&headers).await?;
    if query.since.is_some_and(|id|id< -1){return Err(StatusCode::BAD_REQUEST);}
    let (cursor,unread):(i64,i64)=sqlx::query_as("SELECT COALESCE(MAX(n.id),0)::BIGINT,COUNT(*) FILTER(WHERE n.read_at IS NULL)::BIGINT FROM retone_v2.user_notifications n WHERE n.recipient_id=$1 AND NOT EXISTS(SELECT 1 FROM retone_v2.blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=n.actor_id) OR (b.blocker_id=n.actor_id AND b.blocked_id=$1))")
        .bind(user).fetch_one(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    if query.since==Some(-1){return Ok(Json(serde_json::json!({"notifications":[],"cursor":cursor,"unread":unread})));}
    let history=query.since.is_none();
    let sql=format!("SELECT n.id,n.kind,n.title,n.body,n.room_id,FLOOR(EXTRACT(EPOCH FROM n.created_at)*1000)::BIGINT,n.read_at IS NOT NULL,n.alerts_suppressed OR EXISTS(SELECT 1 FROM retone_v2.room_members rm WHERE rm.room_id=n.room_id AND rm.user_id=n.recipient_id AND rm.notifications_muted) FROM retone_v2.user_notifications n WHERE n.recipient_id=$1 AND n.id>$2 AND NOT EXISTS(SELECT 1 FROM retone_v2.blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=n.actor_id) OR (b.blocker_id=n.actor_id AND b.blocked_id=$1)) ORDER BY n.id {} LIMIT 100",if history{"DESC"}else{"ASC"});
    let rows=sqlx::query_as::<_,(i64,String,String,String,Option<Uuid>,i64,bool,bool)>(&sql)
        .bind(user).bind(query.since.unwrap_or(0)).fetch_all(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    let notices:Vec<Notice>=rows.into_iter().map(|(id,kind,title,body,room_id,created,read,muted)|Notice{id,kind,title,body,room_id,created,read,muted}).collect();
    let next=if history{cursor}else{notices.last().map(|n|n.id).unwrap_or(cursor)};
    Ok(Json(serde_json::json!({"notifications":notices,"cursor":next,"unread":unread,"has_more":next<cursor})))
}

pub async fn mark_read(State(app):State<App>,headers:HeaderMap,Json(input):Json<Read>)->Result<Json<serde_json::Value>,StatusCode>{
    let user=require_user(&app,&headers).await?;
    if input.ids.len()>100||input.ids.iter().any(|id|*id<=0)||(input.all&&!input.ids.is_empty()){return Err(StatusCode::BAD_REQUEST);}
    let changed=sqlx::query("UPDATE retone_v2.user_notifications SET read_at=NOW() WHERE recipient_id=$1 AND ($3 OR id=ANY($2)) AND read_at IS NULL")
        .bind(user).bind(input.ids).bind(input.all).execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.rows_affected();
    Ok(Json(serde_json::json!({"read":changed})))
}

pub async fn one(State(app):State<App>,headers:HeaderMap,Path(id):Path<i64>)->Result<Json<Notice>,StatusCode>{
    let user=require_user(&app,&headers).await?;
    let (id,kind,title,body,room_id,created,read,muted)=sqlx::query_as::<_,(i64,String,String,String,Option<Uuid>,i64,bool,bool)>("SELECT n.id,n.kind,n.title,n.body,n.room_id,FLOOR(EXTRACT(EPOCH FROM n.created_at)*1000)::BIGINT,n.read_at IS NOT NULL,n.alerts_suppressed OR EXISTS(SELECT 1 FROM retone_v2.room_members rm WHERE rm.room_id=n.room_id AND rm.user_id=n.recipient_id AND rm.notifications_muted) FROM retone_v2.user_notifications n WHERE n.recipient_id=$1 AND n.id=$2 AND NOT EXISTS(SELECT 1 FROM retone_v2.blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=n.actor_id) OR (b.blocker_id=n.actor_id AND b.blocked_id=$1))")
        .bind(user).bind(id).fetch_optional(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(Notice{id,kind,title,body,room_id,created,read,muted}))
}
