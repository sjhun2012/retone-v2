package com.retone.app;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import java.util.*;

/** Android System WebView host; no Chrome application or Custom Tabs is used. */
public final class MainActivity extends Activity {
    private static final String HOME="https://retone-v2-mygr.onrender.com/?source=android";
    private static final int FILE_REQUEST=100,MEDIA_REQUEST=101,STORAGE_REQUEST=103;
    private WebView web;
    private ProgressBar progress;
    private LinearLayout errorPanel;
    private ValueCallback<Uri[]> fileResult;
    private Uri cameraUri;
    private PermissionRequest mediaRequest;
    private NativeNotifications notifications;
    private String retryUrl=HOME;
    private String[] pendingDownload;

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(247,240,229));setContentView(root);
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener(){
            @Override public WindowInsets onApplyWindowInsets(View view,WindowInsets insets){
                if(Build.VERSION.SDK_INT>=30){
                    android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
                    android.graphics.Insets keyboard=insets.getInsets(WindowInsets.Type.ime());
                    view.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,keyboard.bottom));
                }else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
                return insets;
            }
        });
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setIndeterminate(true);
        root.addView(progress,new LinearLayout.LayoutParams(-1,6));
        web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));
        notifications=new NativeNotifications(this,web);
        errorPanel=new LinearLayout(this);errorPanel.setOrientation(LinearLayout.VERTICAL);errorPanel.setPadding(40,50,40,40);errorPanel.setVisibility(View.GONE);
        TextView message=new TextView(this);message.setText("Re:tone에 연결하지 못했습니다.\n인터넷 연결을 확인하고 다시 시도해 주세요.");message.setTextSize(17);errorPanel.addView(message);
        Button retry=new Button(this);retry.setText("다시 연결");retry.setOnClickListener(new View.OnClickListener(){@Override public void onClick(View view){web.loadUrl(retryUrl);}});errorPanel.addView(retry);
        root.addView(errorPanel,new LinearLayout.LayoutParams(-1,-1));
        configure();
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT,new OnBackInvokedCallback(){@Override public void onBackInvoked(){back();}});
        openIntent(getIntent());
    }
    private void openIntent(Intent intent){
        long notice=intent.getLongExtra("retone_notice_id",0);
        if(notice>0&&notice<=9007199254740991L){web.loadUrl(HOME+"&notice="+notice);return;}
        Uri data=intent.getData();
        if(data==null){if(web.getUrl()==null)web.loadUrl(HOME);return;}
        String code=AppPolicy.friendCode(data.toString());
        if(code==null){Toast.makeText(this,"올바른 Re:tone 초대 링크가 아닙니다.",Toast.LENGTH_LONG).show();if(web.getUrl()==null)web.loadUrl(HOME);return;}
        web.loadUrl(HOME+"&friend="+code);
    }
    @Override public void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);openIntent(intent);}
    private void configure(){
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString()+" ReToneApp/1.2");
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                if(!request.isForMainFrame())return false;
                if(AppPolicy.trusted(request.getUrl().toString()))return false;
                if(request.hasGesture()&&"https".equals(request.getUrl().getScheme())){
                    try{startActivity(new Intent(Intent.ACTION_VIEW,request.getUrl()));}catch(ActivityNotFoundException ignored){}
                }
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){
                notifications.detach();completeFiles(null);cameraUri=null;if(mediaRequest!=null){mediaRequest.deny();mediaRequest=null;}
                if(AppPolicy.trusted(url))retryUrl=url;
                web.setVisibility(View.VISIBLE);errorPanel.setVisibility(View.GONE);progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view,String url){progress.setVisibility(View.GONE);CookieManager.getInstance().flush();if(AppPolicy.trusted(url))notifications.attach();}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame()){progress.setVisibility(View.GONE);web.setVisibility(View.GONE);errorPanel.setVisibility(View.VISIBLE);}}
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){recreate();return true;}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){return chooseFile(callback,params);}
            @Override public void onPermissionRequest(PermissionRequest request){requestMedia(request);}
            @Override public void onPermissionRequestCanceled(PermissionRequest request){if(mediaRequest==request)mediaRequest=null;}
        });
        web.setDownloadListener(new DownloadListener(){@Override public void onDownloadStart(String url,String agent,String disposition,String mime,long length){download(url,disposition,mime);}});
    }
    private boolean chooseFile(ValueCallback<Uri[]> callback,WebChromeClient.FileChooserParams params){
        if(!AppPolicy.trusted(web.getUrl())){callback.onReceiveValue(null);return true;}
        if(fileResult!=null)fileResult.onReceiveValue(null);fileResult=callback;cameraUri=null;
        final Intent picker=new Intent(Intent.ACTION_OPEN_DOCUMENT);picker.addCategory(Intent.CATEGORY_OPENABLE);
        String[] accepts=params.getAcceptTypes();String mime="*/*";
        if(accepts!=null&&accepts.length==1&&!accepts[0].isEmpty()&&!accepts[0].contains(","))mime=accepts[0];
        picker.setType(mime);picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        if(accepts!=null&&accepts.length>1)picker.putExtra(Intent.EXTRA_MIME_TYPES,accepts);
        try{
            if(mime.startsWith("image/")&&params.isCaptureEnabled()){
                new AlertDialog.Builder(this).setTitle("사진 선택").setItems(new String[]{"카메라로 촬영","저장된 사진 선택"},new DialogInterface.OnClickListener(){@Override public void onClick(DialogInterface dialog,int which){if(which==0)capture();else launchPicker(picker);}})
                    .setOnCancelListener(new DialogInterface.OnCancelListener(){@Override public void onCancel(DialogInterface dialog){completeFiles(null);}}).show();
            }else launchPicker(picker);
        }catch(RuntimeException error){completeFiles(null);Toast.makeText(this,"파일 선택기를 열 수 없습니다.",Toast.LENGTH_LONG).show();}
        return true;
    }
    private void launchPicker(Intent picker){try{startActivityForResult(picker,FILE_REQUEST);}catch(ActivityNotFoundException error){completeFiles(null);}}
    private void capture(){
        if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.CAMERA},104);return;}
        cameraUri=Uri.parse("content://com.retone.app.files/camera/"+UUID.randomUUID().toString()+".jpg");
        Intent camera=new Intent(MediaStore.ACTION_IMAGE_CAPTURE);camera.putExtra(MediaStore.EXTRA_OUTPUT,cameraUri);
        camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);camera.setClipData(ClipData.newRawUri("Re:tone camera",cameraUri));
        try{startActivityForResult(camera,FILE_REQUEST);}catch(RuntimeException error){completeFiles(null);Toast.makeText(this,"카메라를 열 수 없습니다. 저장된 사진을 선택해 주세요.",Toast.LENGTH_LONG).show();}
    }
    private void completeFiles(Uri[] value){if(fileResult!=null){fileResult.onReceiveValue(value);fileResult=null;}}
    @Override public void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=FILE_REQUEST)return;
        Uri[] selected=null;
        if(result==RESULT_OK){
            if(data!=null&&data.getClipData()!=null){ClipData clips=data.getClipData();selected=new Uri[clips.getItemCount()];for(int i=0;i<selected.length;i++)selected[i]=clips.getItemAt(i).getUri();}
            else if(data!=null&&data.getData()!=null)selected=new Uri[]{data.getData()};
            else if(cameraUri!=null){try{if(CameraFileProvider.file(this,cameraUri).length()>0)selected=new Uri[]{cameraUri};}catch(Exception ignored){}}
        }
        completeFiles(selected);cameraUri=null;
    }
    private void requestMedia(PermissionRequest request){
        if(!AppPolicy.trusted(request.getOrigin().toString())||!AppPolicy.trusted(web.getUrl())){request.deny();return;}
        if(mediaRequest!=null)mediaRequest.deny();mediaRequest=request;
        ArrayList<String> needed=new ArrayList<String>();
        for(String resource:request.getResources()){
            String permission=PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)?Manifest.permission.RECORD_AUDIO:PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)?Manifest.permission.CAMERA:null;
            if(permission==null){request.deny();mediaRequest=null;return;}
            if(checkSelfPermission(permission)!=PackageManager.PERMISSION_GRANTED)needed.add(permission);
        }
        if(needed.isEmpty()){request.grant(request.getResources());mediaRequest=null;}
        else requestPermissions(needed.toArray(new String[0]),MEDIA_REQUEST);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);
        if(request==MEDIA_REQUEST&&mediaRequest!=null){PermissionRequest pending=mediaRequest;mediaRequest=null;boolean allowed=AppPolicy.trusted(web.getUrl())&&AppPolicy.trusted(pending.getOrigin().toString());
            for(String resource:pending.getResources()){String permission=PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)?Manifest.permission.RECORD_AUDIO:Manifest.permission.CAMERA;allowed&=checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED;}
            if(allowed)pending.grant(pending.getResources());else pending.deny();
        }
        if(request==104){if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED&&fileResult!=null)capture();else completeFiles(null);}
        if(request==STORAGE_REQUEST&&pendingDownload!=null){String[] download=pendingDownload;pendingDownload=null;if(checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)==PackageManager.PERMISSION_GRANTED)download(download[0],download[1],download[2]);}
        notifications.permissionsResult(request);
    }
    private void download(String url,String disposition,String mime){
        if(!AppPolicy.trusted(web.getUrl())||!AppPolicy.trusted(url))return;
        if(Build.VERSION.SDK_INT<=28&&checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)!=PackageManager.PERMISSION_GRANTED){pendingDownload=new String[]{url,disposition,mime};requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},STORAGE_REQUEST);return;}
        try{DownloadManager.Request request=new DownloadManager.Request(Uri.parse(url));String cookies=CookieManager.getInstance().getCookie(url);if(cookies!=null)request.addRequestHeader("Cookie",cookies);
            String filename=URLUtil.guessFileName(url,disposition,mime).replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");if(filename.length()>150)filename=filename.substring(0,150);
            request.setTitle(filename).setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED).setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,filename);if(mime!=null)request.setMimeType(mime);
            ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);Toast.makeText(this,"다운로드를 시작합니다.",Toast.LENGTH_SHORT).show();
        }catch(RuntimeException error){Toast.makeText(this,"다운로드하지 못했습니다.",Toast.LENGTH_LONG).show();}
    }
    private void back(){web.evaluateJavascript("(()=>{if(document.querySelector('.modal')&&typeof closePopup==='function'){closePopup();return true;}if(typeof roomId!=='undefined'&&roomId&&typeof home==='function'){home();return true;}return false;})()",new ValueCallback<String>(){@Override public void onReceiveValue(String handled){if("true".equals(handled))return;if(web.canGoBack())web.goBack();else finish();}});}
    @Override public void onBackPressed(){back();}
    @Override public void onStop(){super.onStop();CookieManager.getInstance().flush();}
    @Override public void onDestroy(){completeFiles(null);if(mediaRequest!=null)mediaRequest.deny();notifications.detach();if(web!=null){web.stopLoading();web.destroy();}super.onDestroy();}
}
