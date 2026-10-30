package com.lcj.fontstudio;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 字形工坊安卓壳：WebView 加载 assets 里的 HTML 内核（与 Windows 版同一套代码）。
 * 通过 AndroidBridge 桥实现文件保存（SAF）与项目打开。
 */
public class MainActivity extends Activity {

    private static final int REQ_SAVE = 41;
    private static final int REQ_OPEN = 42;

    private WebView web;
    private String pendingSaveBase64;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        // file:// 页面要能 fetch https 的更新检查（version.json 在 GitHub raw 上）
        try { s.setAllowUniversalAccessFromFileURLs(true); } catch (Throwable ignored) {}
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        web.setWebViewClient(new WebViewClient());
        // 没有 WebChromeClient 时 JS 的 alert/confirm 是哑的
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
    }

    /** 暴露给 JS 的能力桥 */
    class Bridge {

        @JavascriptInterface
        public void saveFile(final String name, final String base64) {
            runOnUiThread(new Runnable() {
                public void run() {
                    pendingSaveBase64 = base64;
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("application/octet-stream");
                    i.putExtra(Intent.EXTRA_TITLE, name);
                    try {
                        startActivityForResult(i, REQ_SAVE);
                    } catch (Exception e) {
                        toast("无法打开保存对话框: " + e.getMessage());
                    }
                }
            });
        }

        @JavascriptInterface
        public void openProject() {
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    try {
                        startActivityForResult(i, REQ_OPEN);
                    } catch (Exception e) {
                        toast("无法打开选择对话框: " + e.getMessage());
                    }
                }
            });
        }

        /** 用系统浏览器打开链接（更新下载页等） */
        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception e) {
                        toast("无法打开链接: " + e.getMessage());
                    }
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            pendingSaveBase64 = null;
            return;
        }
        Uri uri = data.getData();
        if (requestCode == REQ_SAVE) {
            writeBase64(uri, pendingSaveBase64);
            pendingSaveBase64 = null;
        } else if (requestCode == REQ_OPEN) {
            readAndSend(uri);
        }
    }

    private void writeBase64(Uri uri, String base64) {
        if (base64 == null) return;
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            OutputStream os = getContentResolver().openOutputStream(uri, "w");
            if (os == null) { toast("无法写入文件"); return; }
            os.write(bytes);
            os.flush();
            os.close();
            toast("已保存 (" + (bytes.length / 1024) + " KB)");
        } catch (Exception e) {
            toast("保存失败: " + e.getMessage());
        }
    }

    private void readAndSend(final Uri uri) {
        try {
            InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) { toast("无法读取文件"); return; }
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
            is.close();
            final String json = new String(bo.toByteArray(), StandardCharsets.UTF_8);
            runOnUiThread(new Runnable() {
                public void run() {
                    web.evaluateJavascript(
                        "window._receiveProjectData(" + org.json.JSONObject.quote(json) + ");",
                        null);
                }
            });
        } catch (Exception e) {
            toast("读取失败: " + e.getMessage());
        }
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        // 有打开的弹窗先关弹窗，否则再退出
        web.evaluateJavascript(
            "(function(){var d=document.querySelector('dialog[open]');" +
            "if(d){d.close();return '1';}return '0';})()",
            new ValueCallback<String>() {
                public void onReceiveValue(String v) {
                    if (!"\"1\"".equals(v)) MainActivity.super.onBackPressed();
                }
            });
    }
}
