package de.skeison.wunschliste;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Die Wunschliste als App: zeigt die echte Webseite (immer die aktuelle Version von GitHub Pages)
 * und ergaenzt, was ein Handy braucht: Teilen, Speichern, Zurueck-Taste, Ziehen zum Aktualisieren,
 * Links zur Wunschliste direkt in der App, eine Seite ohne Verbindung und Hinweise auf neue App-Versionen.
 */
public class MainActivity extends Activity {

    static final String ORIGIN = "https://erschoenfeld2-tech.github.io";
    static final String APP_PATH = "/Skeison_Web/wunschliste";
    static final String HOME = ORIGIN + APP_PATH + "/";
    static final String REPO = "erschoenfeld2-tech/Skeison_Web";
    static final String RELEASE_API = "https://api.github.com/repos/" + REPO + "/releases/tags/app-latest";
    static final String APK_URL = "https://github.com/" + REPO + "/releases/download/app-latest/Wunschliste.apk";

    static final int REQ_FILE = 1, REQ_CAMERA = 2, REQ_NOTIFY = 3;
    static final String PERM_NOTIFY = "android.permission.POST_NOTIFICATIONS";
    static final long SOFT_REFRESH_MS = 60_000L, FULL_RELOAD_MS = 30 * 60_000L, UPDATE_CHECK_MS = 6 * 3600_000L;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private SwipeRefreshLayout swipe;
    private WebView web;
    private View offline;
    private String bridgeJs = "";
    private volatile boolean pageReady;
    private boolean dialogOpen, mainFrameFailed;
    private long backgroundSince;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    private ConnectivityManager.NetworkCallback netCallback;

    // ------------------------------------------------------------------ Start

    @Override
    protected void onCreate(Bundle state) {
        final long start = SystemClock.uptimeMillis();
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        super.onCreate(state);
        // Startbild bleibt, bis die Seite sichtbar ist (hoechstens 3 Sekunden)
        splash.setKeepOnScreenCondition(() -> !pageReady && SystemClock.uptimeMillis() - start < 3000);

        setupWindow();
        bridgeJs = readAsset("bridge.js");

        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.bg));
        swipe = new SwipeRefreshLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.bg));
        swipe.addView(web, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(swipe, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        offline = buildOfflineView();
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Inhalt endet an Statusleiste, Navigationsleiste und Tastatur
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });

        setupSwipe();
        setupWebView();
        watchNetwork();

        if (state == null || web.restoreState(state) == null) web.loadUrl(startUrl(getIntent()));
        checkForUpdate(false);
    }

    private void setupWindow() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        setBarIcons(!night);
    }

    private void setBarIcons(boolean lightBackground) {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(lightBackground);
        c.setAppearanceLightNavigationBars(lightBackground);
    }

    private void setupSwipe() {
        swipe.setColorSchemeColors(Color.rgb(0xff, 0xcb, 0x05), Color.rgb(0x5b, 0x85, 0xff));
        swipe.setProgressBackgroundColorSchemeColor(Color.rgb(0x15, 0x1b, 0x31));
        // Nur ganz oben auf der Seite und nie, waehrend ein Dialog offen ist
        swipe.setOnChildScrollUpCallback((parent, child) -> dialogOpen || web.getScrollY() > 0);
        swipe.setOnRefreshListener(() -> {
            if (mainFrameFailed) retry();
            else web.reload();
        });
    }

    @SuppressWarnings("deprecation")
    private void setupWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);           // Anmeldung bleibt gespeichert (localStorage)
        s.setSupportMultipleWindows(true);      // Links mit target="_blank" landen in onCreateWindow
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " SkeisonWunschlisteApp/" + BuildConfig.VERSION_NAME);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            // Die Seite hat eigene helle und dunkle Designs; Android soll sie nicht zusaetzlich abdunkeln
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        // Nachrichten der Webseite an die App, nur von der eigenen Adresse
        Set<String> origins = Collections.singleton(ORIGIN);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "WunschlisteNative", origins,
                    (view, message, sourceOrigin, isMainFrame, reply) -> {
                        if (isMainFrame && ORIGIN.equals(sourceOrigin.getScheme() + "://" + sourceOrigin.getHost())) {
                            onBridgeMessage(message.getData());
                        }
                    });
        } else {
            web.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void postMessage(String m) { ui.post(() -> onBridgeMessage(m)); }
            }, "WunschlisteNative");
        }

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            if (url != null && url.startsWith("http")) openExternal(Uri.parse(url));
        });
    }

    private String startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        return data != null && isAppUrl(data) ? data.toString() : HOME;
    }

    // ------------------------------------------------------------------ Navigation

    /** Alles unter /Skeison_Web/wunschliste bleibt in der App, alles andere oeffnet der Browser bzw. die passende App. */
    static boolean isAppUrl(Uri u) {
        if (u == null) return false;
        String path = u.getPath() == null ? "" : u.getPath();
        return "https".equals(u.getScheme()) && "erschoenfeld2-tech.github.io".equalsIgnoreCase(u.getHost())
                && (path.equals(APP_PATH) || path.startsWith(APP_PATH + "/"));
    }

    private void openExternal(Uri u) {
        try {
            Intent i;
            if ("intent".equals(u.getScheme())) {
                i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
            } else {
                i = new Intent(Intent.ACTION_VIEW, u);
            }
            startActivity(i);
        } catch (Exception e) {
            toast("Dafür ist keine passende App installiert.");
        }
    }

    private void route(Uri u) {
        if (u == null) return;
        if (isAppUrl(u)) web.loadUrl(u.toString());
        else if (!"about".equals(u.getScheme())) openExternal(u);
    }

    private void inject() {
        if (!bridgeJs.isEmpty()) web.evaluateJavascript(bridgeJs, null);
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (isAppUrl(u) || "about".equals(u.getScheme()) || "blob".equals(u.getScheme()) || "data".equals(u.getScheme())) return false;
            if (!req.isForMainFrame()) return false;
            openExternal(u);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            mainFrameFailed = false;
            dialogOpen = false;
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            inject();
            pageReady = true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            inject();   // zweimal schadet nicht: das Skript prueft selbst, ob es schon laeuft
            pageReady = true;
            swipe.setRefreshing(false);
            if (!mainFrameFailed) offline.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
            if (req.isForMainFrame()) showOffline();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Der Seitenprozess ist abgestuerzt oder wurde beendet: App neu aufbauen statt mitzustuerzen
            swipe.removeView(web);
            web.destroy();
            web = null;
            recreate();
            return true;
        }
    }

    private class Chrome extends WebChromeClient {
        // target="_blank" und window.open: Adresse abfangen, dann in der App oder extern oeffnen
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            final WebView tmp = new WebView(MainActivity.this);
            tmp.setWebViewClient(new WebViewClient() {
                boolean handled;
                private void take(Uri u) {
                    if (handled) return;
                    handled = true;
                    route(u);
                    ui.post(tmp::destroy);
                }
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { take(r.getUrl()); return true; }
                @Override
                public void onPageStarted(WebView v, String url, Bitmap f) { v.stopLoading(); take(Uri.parse(url)); }
            });
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(tmp);
            resultMsg.sendToTarget();
            return true;
        }

        // <input type="file"> (falls die Seite einmal Bilder hochladen laesst)
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), REQ_FILE);
            } catch (Exception e) {
                fileCallback = null;
                toast("Dateiauswahl nicht verfügbar.");
                return false;
            }
            return true;
        }

        // Kamera fuer die Seite (z. B. QR-Code scannen); Mikrofon und alles andere bleibt aus
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            Uri o = request.getOrigin();
            boolean ours = o != null && ORIGIN.equals(o.getScheme() + "://" + o.getHost());
            boolean wantsCamera = false;
            for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
            if (!ours || !wantsCamera) { request.deny(); return; }
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            } else {
                pendingPermission = request;
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == REQ_NOTIFY) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) Notifier.schedule(this, true);
            return;
        }
        if (requestCode == REQ_CAMERA && pendingPermission != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            } else {
                pendingPermission.deny();
            }
            pendingPermission = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (offline.getVisibility() == View.VISIBLE || !pageReady) { moveTaskToBack(true); return; }
        web.evaluateJavascript("window.__wlApp ? window.__wlApp.back() : false", result -> {
            if ("true".equals(result)) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);   // App bleibt im Hintergrund erhalten, wie beim Home-Knopf
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent.getData();
        if (data != null && isAppUrl(data)) web.loadUrl(data.toString());
    }

    // ------------------------------------------------------------------ Lebenszyklus

    @Override
    protected void onPause() {
        super.onPause();
        backgroundSince = SystemClock.elapsedRealtime();
        if (web == null) return;
        web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web == null) return;
        web.onResume();
        if (backgroundSince == 0) return;
        long away = SystemClock.elapsedRealtime() - backgroundSince;
        backgroundSince = 0;
        if (mainFrameFailed) { retry(); return; }
        // Nach einer Pause neu laden, damit Reservierungen und Aenderungen anderer sofort sichtbar sind;
        // nach langer Pause die ganze Seite, damit auch eine neue Version der Webseite geladen wird
        if (away >= FULL_RELOAD_MS) web.evaluateJavascript("window.__wlApp && window.__wlApp.resume(true)", null);
        else if (away >= SOFT_REFRESH_MS) web.evaluateJavascript("window.__wlApp && window.__wlApp.resume(false)", null);
        checkForUpdate(false);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (netCallback != null) {
            try { getSystemService(ConnectivityManager.class).unregisterNetworkCallback(netCallback); } catch (Exception ignored) { }
        }
        if (web != null) {
            web.stopLoading();
            web.destroy();
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------------ Nachrichten von der Webseite (bridge.js)

    private void onBridgeMessage(String raw) {
        try {
            JSONObject m = new JSONObject(raw);
            switch (m.optString("t")) {
                case "share": share(m.optString("title"), m.optString("text"), m.optString("url")); break;
                case "copy": copy(m.optString("text")); break;
                case "save": save(m.optString("name", "download"), m.optString("mime", "application/octet-stream"), m.optString("data")); break;
                case "state": applyState(m); break;
                case "toast": toast(m.optString("text")); break;
                case "notify-data": onNotifyData(m.optJSONObject("data")); break;
                default: break;
            }
        } catch (Exception ignored) { }
    }

    // Erinnerungen: Daten von der Webseite merken und planen (null = abgemeldet)
    private void onNotifyData(JSONObject data) {
        if (data == null) { Notifier.clear(this); return; }
        Notifier.saveSnapshot(this, data);
        Notifier.ensureChannels(this);
        Notifier.schedule(this, true);
        askNotificationPermissionOnce();
    }

    private void askNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(PERM_NOTIFY) == PackageManager.PERMISSION_GRANTED) return;
        SharedPreferences p = getSharedPreferences("app", MODE_PRIVATE);
        if (p.getBoolean("askedNotify", false)) return;
        p.edit().putBoolean("askedNotify", true).apply();
        requestPermissions(new String[]{PERM_NOTIFY}, REQ_NOTIFY);
    }

    private void share(String title, String text, String url) {
        StringBuilder body = new StringBuilder(text == null ? "" : text.trim());
        if (url != null && !url.isEmpty() && body.indexOf(url) < 0) {
            if (body.length() > 0) body.append('\n');
            body.append(url);
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.putExtra(Intent.EXTRA_TEXT, body.toString());
        try { startActivity(Intent.createChooser(send, "Teilen")); } catch (Exception e) { toast("Teilen nicht möglich."); }
    }

    private void copy(String text) {
        ClipboardManager cm = getSystemService(ClipboardManager.class);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Wunschliste", text));
    }

    private void save(String name, String mime, String base64) {
        byte[] bytes;
        try { bytes = Base64.decode(base64, Base64.DEFAULT); } catch (Exception e) { toast("Speichern hat nicht geklappt."); return; }
        String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        boolean image = mime.startsWith("image/");
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/Wunschliste");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                ContentResolver cr = getContentResolver();
                Uri target = image ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI : MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                Uri item = cr.insert(target, v);
                if (item == null) throw new IllegalStateException("insert");
                try (OutputStream os = cr.openOutputStream(item)) { os.write(bytes); }
                v.clear();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(item, v, null, null);
                toast(image ? "Gespeichert in Bilder › Wunschliste" : "Gespeichert in Downloads › Wunschliste");
            } else {
                // Aeltere Android-Versionen: Datei ueber das Teilen-Menue weitergeben (ohne Speicher-Berechtigung)
                File dir = new File(getCacheDir(), "shared");
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("mkdirs");
                File f = new File(dir, safe);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                Uri u = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
                Intent send = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, u).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(send, "Speichern oder teilen"));
            }
        } catch (Exception e) {
            toast("Speichern hat nicht geklappt.");
        }
    }

    private void applyState(JSONObject m) {
        dialogOpen = m.optBoolean("dialog");
        JSONArray bg = m.optJSONArray("bg");
        if (bg != null && bg.length() >= 3) {
            int c = Color.rgb(bg.optInt(0), bg.optInt(1), bg.optInt(2));
            root.setBackgroundColor(c);
            web.setBackgroundColor(c);
        }
        setBarIcons(m.optBoolean("light"));
    }

    // ------------------------------------------------------------------ Ohne Verbindung

    private View buildOfflineView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        int pad = dp(32);
        box.setPadding(pad, pad, pad, pad);
        box.setBackgroundColor(Color.rgb(0x0b, 0x0f, 0x1c));
        box.setClickable(true);

        TextView icon = new TextView(this);
        icon.setText("📡");
        icon.setTextSize(TypedValue.COMPLEX_UNIT_SP, 56);
        icon.setGravity(Gravity.CENTER);
        box.addView(icon);

        TextView title = new TextView(this);
        title.setText("Keine Verbindung");
        title.setTextColor(Color.rgb(0xee, 0xf2, 0xff));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(12), 0, dp(8));
        box.addView(title);

        TextView text = new TextView(this);
        text.setText("Die Wunschliste braucht Internet. Sobald du wieder online bist, lädt sie von selbst weiter.");
        text.setTextColor(Color.rgb(0x9a, 0xa6, 0xcb));
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        text.setGravity(Gravity.CENTER);
        text.setLineSpacing(0, 1.2f);
        box.addView(text);

        Button retry = new Button(this);
        retry.setText("Erneut versuchen");
        retry.setAllCaps(false);
        retry.setTextColor(Color.rgb(0x1a, 0x15, 0x00));
        retry.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(Color.rgb(0xff, 0xcb, 0x05));
        shape.setCornerRadius(dp(10));
        retry.setBackground(shape);
        retry.setPadding(dp(24), 0, dp(24), 0);
        retry.setOnClickListener(v -> retry());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48));
        lp.topMargin = dp(24);
        box.addView(retry, lp);
        return box;
    }

    private void showOffline() {
        mainFrameFailed = true;
        pageReady = true;
        swipe.setRefreshing(false);
        offline.setVisibility(View.VISIBLE);
        root.setBackgroundColor(Color.rgb(0x0b, 0x0f, 0x1c));   // auch hinter Status- und Navigationsleiste
        setBarIcons(false);
    }

    private void retry() {
        String url = web.getUrl();
        offline.setVisibility(View.GONE);
        mainFrameFailed = false;
        web.loadUrl(url != null && isAppUrl(Uri.parse(url)) ? url : HOME);
    }

    private void watchNetwork() {
        try {
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            netCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    ui.postDelayed(() -> { if (mainFrameFailed && !isFinishing()) retry(); }, 800);
                }
            };
            cm.registerDefaultNetworkCallback(netCallback);
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------ Neue App-Version

    /**
     * Die Webseite ist in der App immer aktuell. Nur wenn sich die App selbst aendert, baut GitHub eine neue
     * Version (Release "app-latest"); dann bietet die App das Update an.
     */
    private void checkForUpdate(boolean force) {
        final SharedPreferences prefs = getSharedPreferences("app", MODE_PRIVATE);
        long now = System.currentTimeMillis();
        if (!force && now - prefs.getLong("lastUpdateCheck", 0) < UPDATE_CHECK_MS) return;
        prefs.edit().putLong("lastUpdateCheck", now).apply();
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(RELEASE_API).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                c.setRequestProperty("User-Agent", "SkeisonWunschlisteApp");
                if (c.getResponseCode() != 200) return;
                JSONObject j = new JSONObject(readAll(c.getInputStream()));
                Matcher m = Pattern.compile("versionCode[:=]\\s*(\\d+)").matcher(j.optString("body") + " " + j.optString("name"));
                if (!m.find()) return;
                final int latest = Integer.parseInt(m.group(1));
                if (latest > BuildConfig.VERSION_CODE) ui.post(() -> offerUpdate(latest));
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    private void offerUpdate(int latest) {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
                .setTitle("Neue App-Version")
                .setMessage("Version 1." + latest + " der Wunschliste-App ist da (du hast " + BuildConfig.VERSION_NAME + ").\n\n"
                        + "Deine Wünsche und Listen bleiben erhalten. Nach dem Download einfach die Datei öffnen und installieren.")
                .setPositiveButton("Jetzt laden", (d, w) -> openExternal(Uri.parse(APK_URL)))
                .setNegativeButton("Später", null)
                .show();
    }

    // ------------------------------------------------------------------ Hilfen

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) { return readAll(in); } catch (Exception e) { return ""; }
    }

    private static String readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }
}
