use super::*;

#[derive(Deserialize)]
pub(super) struct Preference {
    notifications_muted: bool,
}

pub(super) async fn get_preference(
    State(app): State<App>, Path(room): Path<Uuid>, headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user = require_user(&app, &headers).await?;
    let muted = sqlx::query_scalar::<_, bool>("SELECT notifications_muted FROM retone_v2.room_members WHERE room_id=$1 AND user_id=$2")
        .bind(room).bind(user).fetch_optional(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::FORBIDDEN)?;
    Ok(Json(serde_json::json!({"notifications_muted":muted})))
}

pub(super) async fn set_preference(
    State(app): State<App>, Path(room): Path<Uuid>, headers: HeaderMap, Json(input): Json<Preference>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user = require_user(&app, &headers).await?;
    let mut tx = app.db.begin().await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    let changed = sqlx::query("UPDATE retone_v2.room_members SET notifications_muted=$3 WHERE room_id=$1 AND user_id=$2")
        .bind(room).bind(user).bind(input.notifications_muted).execute(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.rows_affected();
    if changed == 0 { return Err(StatusCode::FORBIDDEN); }
    if input.notifications_muted {
        // Previously queued alerts must not reappear when the room is unmuted.
        sqlx::query("UPDATE retone_v2.push_jobs j SET completed_at=NOW(),locked_until=NULL,outcome='room-muted' FROM retone_v2.user_notifications n WHERE n.id=j.notification_id AND n.recipient_id=$1 AND n.room_id=$2 AND j.completed_at IS NULL")
            .bind(user).bind(room).execute(&mut *tx).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    tx.commit().await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({"notifications_muted":input.notifications_muted})))
}
