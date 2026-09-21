package com.hummusfit.autoprint;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
  private static final String PREFS = "printer";
  private static final String PRINTER_IP = "printer_ip";
  private static final String DEFAULT_IP = "10.0.75.254";
  private static final String PICKING_URL = "https://hummusfit-route-board-production.up.railway.app/picking";
  private static final String ALLOWED_ORIGIN = "https://hummusfit-route-board-production.up.railway.app";
  private static final int BRIDGE_PORT = 8877;

  private static SharedPreferences prefs(Context context) {
    return context.getSharedPreferences(PREFS, MODE_PRIVATE);
  }

  private static boolean validPrivateIp(String input) {
    String[] parts = input.split("\\.");
    if (parts.length != 4) return false;
    int[] n = new int[4];
    try {
      for (int i = 0; i < 4; i++) {
        if (parts[i].isEmpty() || parts[i].length() > 3) return false;
        n[i] = Integer.parseInt(parts[i]);
        if (n[i] < 0 || n[i] > 255) return false;
      }
    } catch (NumberFormatException e) { return false; }
    return n[0] == 10 || (n[0] == 192 && n[1] == 168) ||
        (n[0] == 172 && n[1] >= 16 && n[1] <= 31);
  }

  static void startBridge(Context context) {
    Intent intent = new Intent(context, PrintBridgeService.class);
    if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
    else context.startService(intent);
  }

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    startBridge(this);

    int pad = (int)(20 * getResources().getDisplayMetrics().density);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setPadding(pad, pad, pad, pad);
    layout.setBackgroundColor(Color.WHITE);

    TextView title = new TextView(this);
    title.setText("HF Auto Print");
    title.setTextColor(Color.rgb(17, 54, 51));
    title.setTextSize(25);
    layout.addView(title);

    TextView description = new TextView(this);
    description.setText("Keep this companion installed on the NETUM. After each crate is saved in Order Picking, it sends one 4 × 3 label to the Zebra over Wi-Fi. The ongoing notification means the print service is running.");
    description.setTextSize(16);
    description.setPadding(0, pad, 0, pad);
    layout.addView(description);

    TextView ipLabel = new TextView(this);
    ipLabel.setText("Zebra printer IP address");
    layout.addView(ipLabel);

    EditText ip = new EditText(this);
    ip.setSingleLine(true);
    ip.setInputType(android.text.InputType.TYPE_CLASS_PHONE);
    ip.setText(prefs(this).getString(PRINTER_IP, DEFAULT_IP));
    layout.addView(ip);

    Button save = new Button(this);
    save.setText("Save printer IP");
    save.setOnClickListener(v -> {
      String value = ip.getText().toString().trim();
      if (!validPrivateIp(value)) {
        Toast.makeText(this, "Enter a private network IPv4 address", Toast.LENGTH_LONG).show();
        return;
      }
      prefs(this).edit().putString(PRINTER_IP, value).apply();
      startBridge(this);
      Toast.makeText(this, "Printer saved: " + value, Toast.LENGTH_SHORT).show();
    });
    layout.addView(save);

    Button picking = new Button(this);
    picking.setText("Open Order Picking");
    picking.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(PICKING_URL))));
    layout.addView(picking);

    setContentView(layout);
  }

  public static class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
      if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) startBridge(context);
    }
  }

  public static class PrintBridgeService extends Service {
    private final ExecutorService workers = Executors.newFixedThreadPool(2);
    private final Map<String, Boolean> completedJobs = new LinkedHashMap<String, Boolean>(128, .75f, true) {
      @Override protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
        return size() > 128;
      }
    };
    private ServerSocket server;
    private Thread acceptThread;

    @Override public void onCreate() {
      super.onCreate();
      NotificationManager manager = getSystemService(NotificationManager.class);
      if (Build.VERSION.SDK_INT >= 26) {
        NotificationChannel channel = new NotificationChannel("hf-print", "HF Auto Print", NotificationManager.IMPORTANCE_LOW);
        manager.createNotificationChannel(channel);
      }
      PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
          Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
      Notification notification = new Notification.Builder(this, "hf-print")
          .setSmallIcon(android.R.drawable.ic_menu_send)
          .setContentTitle("HF Auto Print running")
          .setContentText("Zebra crate labels are ready")
          .setContentIntent(open)
          .setOngoing(true)
          .build();
      startForeground(11, notification);
      acceptThread = new Thread(this::serve, "hf-print-listener");
      acceptThread.start();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
      return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
      try { if (server != null) server.close(); } catch (Exception ignored) {}
      workers.shutdownNow();
      super.onDestroy();
    }

    private void bindToWifi(Socket socket) throws Exception {
      ConnectivityManager connectivity =
          (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
      if (connectivity == null) throw new Exception("Network service unavailable");
      for (Network network : connectivity.getAllNetworks()) {
        NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
        if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
          network.bindSocket(socket);
          return;
        }
      }
      throw new Exception("NETUM is not connected to Wi-Fi");
    }

    private void serve() {
      try {
        server = new ServerSocket(BRIDGE_PORT, 8, InetAddress.getByName("127.0.0.1"));
        while (!server.isClosed()) {
          Socket client = server.accept();
          workers.execute(() -> handle(client));
        }
      } catch (Exception e) {
        android.util.Log.e("HFAutoPrint", "Bridge listener stopped", e);
      }
    }

    private String line(InputStream in) throws Exception {
      ByteArrayOutputStream buffer = new ByteArrayOutputStream();
      int b;
      while ((b = in.read()) != -1 && b != '\n') {
        if (buffer.size() >= 8192) throw new Exception("Header too long");
        if (b != '\r') buffer.write(b);
      }
      return buffer.toString("UTF-8");
    }

    private void respond(OutputStream out, int code, JSONObject body, boolean cors) throws Exception {
      byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
      String status = code == 200 ? "OK" : code == 204 ? "No Content" : code == 403 ? "Forbidden" : code == 409 ? "Conflict" : code == 503 ? "Unavailable" : "Bad Request";
      String headers = "HTTP/1.1 " + code + " " + status + "\r\n" +
          "Content-Type: application/json\r\n" +
          "Content-Length: " + (code == 204 ? 0 : bytes.length) + "\r\n" +
          "Connection: close\r\n" +
          "Cache-Control: no-store\r\n" +
          (cors ? "Access-Control-Allow-Origin: " + ALLOWED_ORIGIN + "\r\n" +
              "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
              "Access-Control-Allow-Headers: content-type, x-hf-print\r\n" +
              "Access-Control-Allow-Private-Network: true\r\n" +
              "Vary: Origin\r\n" : "") + "\r\n";
      out.write(headers.getBytes(StandardCharsets.US_ASCII));
      if (code != 204) out.write(bytes);
      out.flush();
    }

    private JSONObject json(boolean ok, String message) throws Exception {
      return new JSONObject().put("ok", ok).put("message", message);
    }

    private void handle(Socket client) {
      try (Socket connection = client) {
        connection.setSoTimeout(10000);
        InputStream in = connection.getInputStream();
        OutputStream out = connection.getOutputStream();
        String[] request = line(in).split(" ");
        if (request.length < 2) return;
        Map<String, String> headers = new LinkedHashMap<>();
        for (int i = 0; i < 64; i++) {
          String text = line(in);
          if (text.isEmpty()) break;
          int colon = text.indexOf(':');
          if (colon > 0) headers.put(text.substring(0, colon).toLowerCase(Locale.US), text.substring(colon + 1).trim());
        }
        boolean allowed = ALLOWED_ORIGIN.equals(headers.get("origin"));
        if (!allowed) {
          respond(out, 403, json(false, "Origin not allowed"), false);
          return;
        }
        if ("OPTIONS".equals(request[0])) {
          respond(out, 204, json(true, "preflight"), true);
          return;
        }
        if ("GET".equals(request[0]) && "/status".equals(request[1])) {
          respond(out, 200, json(true, "HF Auto Print ready").put("printerIp", prefs(this).getString(PRINTER_IP, DEFAULT_IP)), true);
          return;
        }
        if (!"POST".equals(request[0]) || !"/print".equals(request[1]) ||
            !"1".equals(headers.get("x-hf-print")) ||
            !headers.getOrDefault("content-type", "").startsWith("application/json")) {
          respond(out, 400, json(false, "Invalid print request"), true);
          return;
        }
        int length = Integer.parseInt(headers.getOrDefault("content-length", "0"));
        if (length < 1 || length > 32768) {
          respond(out, 400, json(false, "Invalid job size"), true);
          return;
        }
        byte[] body = new byte[length];
        int read = 0;
        while (read < length) {
          int n = in.read(body, read, length - read);
          if (n < 0) throw new Exception("Incomplete job");
          read += n;
        }
        JSONObject job = new JSONObject(new String(body, StandardCharsets.UTF_8));
        String jobId = job.optString("jobId", "");
        String zpl = job.optString("zpl", "");
        if (jobId.length() < 8 || jobId.length() > 128 || !zpl.startsWith("^XA") || !zpl.trim().endsWith("^XZ")) {
          respond(out, 400, json(false, "Invalid Zebra job"), true);
          return;
        }
        synchronized (completedJobs) {
          if (completedJobs.containsKey(jobId)) {
            respond(out, 200, json(true, "Already sent").put("duplicate", true), true);
            return;
          }
        }
        String ip = prefs(this).getString(PRINTER_IP, DEFAULT_IP);
        if (!validPrivateIp(ip)) {
          respond(out, 503, json(false, "Printer IP is not configured"), true);
          return;
        }
        try (Socket printer = new Socket()) {
          // Q900 handhelds may keep a cellular route alongside warehouse
          // Wi-Fi. Bind the private-address printer connection to Wi-Fi so
          // Android cannot send it through the wrong interface.
          bindToWifi(printer);
          printer.connect(new InetSocketAddress(ip, 9100), 3500);
          printer.setSoTimeout(3500);
          OutputStream printerOut = printer.getOutputStream();
          // Ask for host status on the same connection after the label. Waiting
          // for the first status byte proves the Zebra received and parsed the
          // stream before Android closes the socket. Some Q900 units otherwise
          // complete close() quickly enough that the printer sees an empty job.
          printerOut.write(zpl.getBytes(StandardCharsets.US_ASCII));
          printerOut.write("\r\n~HS\r\n".getBytes(StandardCharsets.US_ASCII));
          printerOut.flush();
          if (printer.getInputStream().read() < 0) {
            throw new Exception("Zebra closed without acknowledging the job");
          }
        } catch (Exception e) {
          android.util.Log.e("HFAutoPrint", "Zebra job failed", e);
          respond(out, 503, json(false, "Zebra did not accept the job at " + ip + ": " + e.getClass().getSimpleName() + " " + String.valueOf(e.getMessage())), true);
          return;
        }
        synchronized (completedJobs) { completedJobs.put(jobId, true); }
        respond(out, 200, json(true, "Sent to Zebra").put("duplicate", false), true);
      } catch (Exception e) {
        android.util.Log.e("HFAutoPrint", "Print request failed", e);
      }
    }
  }
}
