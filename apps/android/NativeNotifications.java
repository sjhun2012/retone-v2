package com.retone.app;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.*;
import org.json.JSONObject;
import java.io.*;
import java.util.UUID;

/** Only a private message port transferred to the trusted top-level document can request notices. */
final class NativeNotifications {
    private final Activity activity;
    private final WebView web;
    private WebMessagePort port;
    private String replyId;
    private int generation;
    private static final int REQUEST=102;
    NativeNotifications(Activity activity,WebView web){this.activity=activity;this.web=web;manager().createNotificationChannel(new NotificationChannel("retone-chat","Re:tone 대화",NotificationManager.IMPORTANCE_DEFAULT));}
    private NotificationManager manager(){return (NotificationManager)activity.getSystemService(Context.NOTIFICATION_SERVICE);}
    void detach(){generation++;if(port!=null){port.close();port=null;}replyId=null;}
    private String permission(){
        if(Build.VERSION.SDK_INT>=33&&activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return activity.getPreferences(0).getBoolean("notice-asked",false)?"denied":"default";
        return manager().areNotificationsEnabled()?"granted":"denied";
    }
    void attach(){if(port!=null||!AppPolicy.trusted(web.getUrl()))return;
        try{
            InputStream input=activity.getAssets().open("native-notifications.js");ByteArrayOutputStream buffer=new ByteArrayOutputStream();byte[] chunk=new byte[4096];int count;
            try{while((count=input.read(chunk))!=-1)buffer.write(chunk,0,count);}finally{input.close();}
            final String secret=UUID.randomUUID().toString();
            final int current=generation;
            String source=buffer.toString("UTF-8")+"("+JSONObject.quote(secret)+","+JSONObject.quote(permission())+");";
            web.evaluateJavascript(source,new ValueCallback<String>(){@Override public void onReceiveValue(String ignored){
                if(current!=generation||!AppPolicy.trusted(web.getUrl()))return;
                WebMessagePort[] channel=web.createWebMessageChannel();port=channel[0];
                port.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){@Override public void onMessage(WebMessagePort sender,WebMessage message){receive(message.getData());}});
                web.postWebMessage(new WebMessage(secret,new WebMessagePort[]{channel[1]}),Uri.parse(AppPolicy.ORIGIN));
            }});
        }catch(Exception ignored){}
    }
    private void receive(String value){if(!AppPolicy.trusted(web.getUrl())||value==null||value.length()>5000)return;
        try{JSONObject data=new JSONObject(value);String action=data.optString("action");
            if("push-token".equals(action)){
                final String id=data.optString("id");if(id.length()>20||!"granted".equals(permission()))return;
                final int current=generation;
                PushClient.token(activity,new PushClient.Callback(){@Override public void complete(String token,String error){if(current!=generation)return;replyPush(id,token,error);}});
            }else if("push-installation".equals(action)){
                String id=data.optString("id");if(id.length()<=20)replyPush(id,null,null);
            }else if("push-bind".equals(action)){
                PushClient.bind(activity,data.optString("user"),data.optBoolean("enabled",false));
            }else if("permission".equals(action)){
                String id=data.optString("id");if(id.length()>20)return;
                if(Build.VERSION.SDK_INT>=33&&activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
                    if(replyId!=null)return;replyId=id;activity.getPreferences(0).edit().putBoolean("notice-asked",true).apply();activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},REQUEST);
                }else reply(id);
            }else if("notify".equals(action)&&"granted".equals(permission())){
                String title=data.optString("title","Re:tone"),body=data.optString("body"),tag=data.optString("tag","retone");
                if(title.length()>120||body.length()>3000||tag.length()>200)return;
                PendingIntent launch=PendingIntent.getActivity(activity,0,new Intent(activity,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                Notification notice=new Notification.Builder(activity,"retone-chat").setSmallIcon(android.R.drawable.ic_dialog_email).setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true).setOnlyAlertOnce(true).setContentIntent(launch).build();
                manager().notify(tag,0,notice);
            }
        }catch(Exception ignored){}
    }
    private void replyPush(String id,String token,String error){if(port==null||!AppPolicy.trusted(web.getUrl()))return;
        try{JSONObject value=new JSONObject(),push=new JSONObject();value.put("id",id);push.put("installation_id",PushClient.installation(activity));if(token!=null)push.put("token",token);if(error!=null)push.put("error",error);value.put("push",push);port.postMessage(new WebMessage(value.toString()));}catch(Exception ignored){}
    }
    private void reply(String id){if(port==null||!AppPolicy.trusted(web.getUrl()))return;try{JSONObject data=new JSONObject();data.put("id",id);data.put("permission",permission());port.postMessage(new WebMessage(data.toString()));}catch(Exception ignored){}}
    void permissionsResult(int request){if(request==REQUEST&&replyId!=null){String id=replyId;replyId=null;reply(id);}}
}
