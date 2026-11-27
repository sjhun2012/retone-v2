use axum::{body::Body, extract::{Path,State}, http::{HeaderMap,StatusCode,header}, response::Response};
use base64::{Engine,engine::general_purpose::STANDARD};
use uuid::Uuid;
use crate::{App,require_user,require_room_member};

pub const MAX_IMAGE_BYTES:usize=8*1024*1024;
pub struct Image {pub mime:String,pub bytes:Vec<u8>}

pub fn decode_image(value:&str)->Result<Image,StatusCode>{
    if value.len()>MAX_IMAGE_BYTES.div_ceil(3)*4+64{return Err(StatusCode::PAYLOAD_TOO_LARGE);}
    let (prefix,data)=value.split_once(',').ok_or(StatusCode::BAD_REQUEST)?;
    let mime=match prefix{
        "data:image/jpeg;base64"=>"image/jpeg",
        "data:image/png;base64"=>"image/png",
        "data:image/webp;base64"=>"image/webp",
        "data:image/gif;base64"=>"image/gif",
        _=>return Err(StatusCode::BAD_REQUEST),
    };
    let bytes=STANDARD.decode(data).map_err(|_|StatusCode::BAD_REQUEST)?;
    if bytes.is_empty()||bytes.len()>MAX_IMAGE_BYTES{return Err(StatusCode::PAYLOAD_TOO_LARGE);}
    let signature=match mime{
        "image/jpeg"=>bytes.starts_with(&[0xff,0xd8,0xff]),
        "image/png"=>bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/webp"=>bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"WEBP"),
        "image/gif"=>bytes.starts_with(b"GIF87a")||bytes.starts_with(b"GIF89a"),
        _=>false,
    };
    if !signature{return Err(StatusCode::BAD_REQUEST);}
    Ok(Image{mime:mime.into(),bytes})
}

pub async fn image(State(app):State<App>,Path((room,message)):Path<(Uuid,Uuid)>,headers:HeaderMap)->Result<Response,StatusCode>{
    let user=require_user(&app,&headers).await?;
    require_room_member(&app,room,user).await?;
    let row=sqlx::query_as::<_,(String,Vec<u8>)>("SELECT i.mime,i.payload FROM retone_v2.message_images i JOIN retone_v2.messages m ON m.id=i.message_id WHERE m.id=$1 AND m.room_id=$2 AND m.deleted_at IS NULL")
        .bind(message).bind(room).fetch_optional(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::NOT_FOUND)?;
    Response::builder().header(header::CONTENT_TYPE,row.0).header(header::CACHE_CONTROL,"private, no-store").header("X-Content-Type-Options","nosniff")
        .body(Body::from(row.1)).map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn rejects_remote_urls_svg_and_forged_image_types(){
        for value in ["https://evil.test/x.png","data:image/svg+xml;base64,PHN2Zz4=","data:image/png;base64,SGVsbG8="]{assert!(decode_image(value).is_err());}
    }
    #[test]fn preserves_png_bytes_and_enforces_limit(){
        let value="data:image/png;base64,iVBORw0KGgo=";let image=decode_image(value).unwrap();assert_eq!(image.bytes.as_slice(),b"\x89PNG\r\n\x1a\n");assert_eq!(image.mime,"image/png");
        assert_eq!(decode_image(&format!("data:image/png;base64,{}","A".repeat(MAX_IMAGE_BYTES.div_ceil(3)*4+65))).err(),Some(StatusCode::PAYLOAD_TOO_LARGE));
    }
}
