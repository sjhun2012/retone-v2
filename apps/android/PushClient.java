package com.retone.app;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

final class PushClient {
    interface Callback{void complete(String token,String error);}
    private static SharedPreferences preferences(Context context){return context.getSharedPreferences("retone-push",0);}
    static void initialize(Context context){
        try{
            if(FirebaseApp.getApps(context).isEmpty()){
                InputStream stream=context.getAssets().open("firebase-client.json");ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int read;
                try{while((read=stream.read(buffer))!=-1)bytes.write(buffer,0,read);}finally{stream.close();}
                JSONObject config=new JSONObject(bytes.toString("UTF-8")),android=config.getJSONObject("android");
                FirebaseOptions options=new FirebaseOptions.Builder().setApplicationId(android.getString("appId")).setApiKey(android.getString("apiKey")).setGcmSenderId(android.getString("senderId")).setProjectId(config.getString("projectId")).build();
                FirebaseApp.initializeApp(context,options);
            }
            FirebaseMessaging.getInstance().setAutoInitEnabled(preferences(context).getBoolean("enabled",false));
            manager(context).createNotificationChannel(new NotificationChannel("retone-chat","Re:tone 알림",NotificationManager.IMPORTANCE_DEFAULT));
        }catch(Exception ignored){/* Chat remains usable if push cannot initialize. */}
    }
    static synchronized String installation(Context context){
        SharedPreferences prefs=preferences(context);String id=prefs.getString("installation","");
        if(id.isEmpty()){id=UUID.randomUUID().toString();prefs.edit().putString("installation",id).apply();}return id;
    }
    static void token(Activity activity,final Callback callback){
        try{FirebaseMessaging.getInstance().getToken().addOnCompleteListener(activity,new OnCompleteListener<String>(){
            @Override public void onComplete(Task<String> result){callback.complete(result.isSuccessful()?result.getResult():null,result.isSuccessful()?null:"token-unavailable");}
        });}catch(RuntimeException error){callback.complete(null,"push-unavailable");}
    }
    static void bind(Context context,String user,boolean enabled){
        if(!enabled||!validUser(user)){user="";enabled=false;}
        SharedPreferences prefs=preferences(context);
        if(!user.equals(prefs.getString("user","")))manager(context).cancelAll();
        prefs.edit().putString("user",user).putBoolean("enabled",enabled).apply();
        try{FirebaseMessaging.getInstance().setAutoInitEnabled(enabled);}catch(RuntimeException ignored){}
    }
    private static boolean validUser(String user){try{return user!=null&&UUID.fromString(user).toString().equals(user);}catch(IllegalArgumentException error){return false;}}
    private static NotificationManager manager(Context context){return (NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);}
    static synchronized void show(Context context,String rawId,String user,String title,String body){
        SharedPreferences prefs=preferences(context);long id;
        try{id=Long.parseLong(rawId);if(id<=0||id>9007199254740991L)return;}catch(Exception error){return;}
        if(!validUser(user)||!prefs.getBoolean("enabled",false)||!user.equals(prefs.getString("user","")))return;
        if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
        if(!manager(context).areNotificationsEnabled())return;
        String seen=prefs.getString("seen",","),key=user+":"+id+",";if(seen.contains(","+key))return;
        seen+=key;while(seen.length()>12000){int end=seen.indexOf(',',1);if(end<0)break;seen=seen.substring(end);}
        prefs.edit().putString("seen",seen).apply();
        String cleanTitle=title==null?"Re:tone":title.substring(0,Math.min(title.length(),120));
        String cleanBody=body==null?"새 알림이 도착했어요.":body.substring(0,Math.min(body.length(),1000));
        Intent intent=new Intent(context,MainActivity.class).setData(Uri.parse(AppPolicy.ORIGIN+"/?notice="+id)).putExtra("retone_notice_id",id);
        PendingIntent open=PendingIntent.getActivity(context,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification notification=new Notification.Builder(context,"retone-chat").setSmallIcon(android.R.drawable.ic_dialog_email).setContentTitle(cleanTitle).setContentText(cleanBody).setStyle(new Notification.BigTextStyle().bigText(cleanBody)).setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).build();
        manager(context).notify("retone-event-"+id,0,notification);
    }
    static void refreshRegistration(Context context,String token){
        SharedPreferences prefs=preferences(context);String user=prefs.getString("user","");
        if(!prefs.getBoolean("enabled",false)||!validUser(user)||token==null)return;
        HttpURLConnection connection=null;
        try{
            String cookie=CookieManager.getInstance().getCookie(AppPolicy.ORIGIN);if(cookie==null||!cookie.contains("retone_session="))return;
            JSONObject input=new JSONObject();input.put("installation_id",installation(context));input.put("platform","android");input.put("token",token);
            connection=(HttpURLConnection)new URL(AppPolicy.ORIGIN+"/api/push/devices").openConnection();connection.setConnectTimeout(8000);connection.setReadTimeout(8000);connection.setInstanceFollowRedirects(false);connection.setRequestMethod("POST");connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Cookie",cookie);connection.setRequestProperty("X-ReTone-User",user);
            byte[] bytes=input.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(bytes.length);
            try(OutputStream output=connection.getOutputStream()){output.write(bytes);}
            int result=connection.getResponseCode();if(result==401||result==403)bind(context,"",false);
        }catch(Exception ignored){/* Foreground enrollment retries the latest token. */}
        finally{if(connection!=null)connection.disconnect();}
    }
}
