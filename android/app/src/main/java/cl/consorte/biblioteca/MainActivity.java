package cl.consorte.biblioteca;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.*;
import android.widget.Toast;
import java.io.InputStream;
import java.io.IOException;
public class MainActivity extends Activity {
  private static final int SELECT_FILES=1122;
  private static final String SITE="https://consorte.app.local/";
  private WebView webView;
  private ValueCallback<Uri[]> fileSelection;
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().setStatusBarColor(Color.rgb(250,241,223));
    getWindow().setNavigationBarColor(Color.rgb(51,39,29));
    webView=new WebView(this);
    webView.setLayoutParams(new ViewGroup.LayoutParams(-1,-1));
    setContentView(webView);
    WebSettings settings=webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    webView.setWebChromeClient(new WebChromeClient(){
      @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if(fileSelection!=null)fileSelection.onReceiveValue(null);
        fileSelection=callback;
        try {
          Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
          intent.addCategory(Intent.CATEGORY_OPENABLE);
          intent.setType("*/*");
          intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
          startActivityForResult(intent,SELECT_FILES);
          return true;
        } catch(Exception e) {
          fileSelection=null;
          Toast.makeText(MainActivity.this,"No se pudo seleccionar archivo",Toast.LENGTH_SHORT).show();
          return false;
        }
      }
    });
    webView.setWebViewClient(new WebViewClient(){
      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri=request.getUrl();
        if(!"consorte.app.local".equals(uri.getHost()))return null;
        String path=uri.getPath();
        if(path==null||path.equals("/")||path.equals("/index.html")){
          try {
            InputStream content=getAssets().open("index.html");
            return new WebResourceResponse("text/html","UTF-8",content);
          } catch(IOException e){return null;}
        }
        return null;
      }
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri=request.getUrl();
        if("consorte.app.local".equals(uri.getHost())||"blob".equals(uri.getScheme()))return false;
        if("https".equals(uri.getScheme())||"http".equals(uri.getScheme())){
          try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}
        }
        return true;
      }
    });
    webView.loadUrl(SITE+"index.html");
  }
  @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
    super.onActivityResult(requestCode,resultCode,data);
    if(requestCode!=SELECT_FILES||fileSelection==null)return;
    Uri[] result=null;
    if(resultCode==RESULT_OK&&data!=null){
      if(data.getClipData()!=null){
        int count=data.getClipData().getItemCount();result=new Uri[count];
        for(int i=0;i<count;i++)result[i]=data.getClipData().getItemAt(i).getUri();
      }else if(data.getData()!=null)result=new Uri[]{data.getData()};
    }
    fileSelection.onReceiveValue(result);fileSelection=null;
  }
  @Override public void onBackPressed(){
    if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();
  }
  @Override protected void onDestroy(){if(webView!=null)webView.destroy();super.onDestroy();}
}
