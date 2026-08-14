const fs=require('fs');
const path=require('path');

const root=process.cwd();
const javaDir=path.join(root,'android','app','src','main','java','in','highloops','brottta');
if(!fs.existsSync(path.join(root,'android'))){
  console.error('Android project not found. Run: npx cap add android');
  process.exit(1);
}
fs.mkdirSync(javaDir,{recursive:true});

const plugin=`package in.highloops.brottta;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
  name = "NativePrinter",
  permissions = {
    @Permission(alias="btConnect", strings={
      Manifest.permission.BLUETOOTH_CONNECT
    })
  }
)
public class NativePrinterPlugin extends Plugin {
  private static final UUID SPP_UUID=UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

  private boolean needsBtPermission(){
    return Build.VERSION.SDK_INT>=Build.VERSION_CODES.S &&
      getContext().checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=android.content.pm.PackageManager.PERMISSION_GRANTED;
  }

  @PermissionCallback
  private void listBluetoothDevicesPermissionCallback(PluginCall call){
    if(getPermissionState("btConnect")==PermissionState.GRANTED){
      listBluetoothDevices(call);
    }else{
      call.reject("Nearby devices permission is required to show paired Bluetooth printers.");
    }
  }

  @PermissionCallback
  private void testBluetoothPermissionCallback(PluginCall call){
    if(getPermissionState("btConnect")==PermissionState.GRANTED){
      testBluetooth(call);
    }else{
      call.reject("Nearby devices permission is required to connect to the Bluetooth printer.");
    }
  }

  @PermissionCallback
  private void printBluetoothPermissionCallback(PluginCall call){
    if(getPermissionState("btConnect")==PermissionState.GRANTED){
      printBluetooth(call);
    }else{
      call.reject("Nearby devices permission is required to print over Bluetooth.");
    }
  }

  @PluginMethod
  public void listBluetoothDevices(PluginCall call){
    if(needsBtPermission()){ requestPermissionForAlias("btConnect",call,"listBluetoothDevicesPermissionCallback"); return; }
    try{
      BluetoothAdapter adapter=BluetoothAdapter.getDefaultAdapter();
      if(adapter==null){call.reject("Bluetooth is not supported on this tablet.");return;}
      Set<BluetoothDevice> bonded=adapter.getBondedDevices();
      JSArray arr=new JSArray();
      for(BluetoothDevice d:bonded){
        JSObject o=new JSObject();
        o.put("name",d.getName());
        o.put("address",d.getAddress());
        arr.put(o);
      }
      JSObject result=new JSObject();result.put("devices",arr);call.resolve(result);
    }catch(Exception e){call.reject(e.getMessage());}
  }

  @PluginMethod
  public void testBluetooth(PluginCall call){
    if(needsBtPermission()){ requestPermissionForAlias("btConnect",call,"testBluetoothPermissionCallback"); return; }
    String address=call.getString("address");
    if(address==null){call.reject("Bluetooth address is required.");return;}
    new Thread(()->{
      BluetoothSocket socket=null;
      try{
        BluetoothAdapter adapter=BluetoothAdapter.getDefaultAdapter();
        BluetoothDevice device=adapter.getRemoteDevice(address);
        socket=device.createRfcommSocketToServiceRecord(SPP_UUID);
        socket.connect();
        socket.close();
        JSObject r=new JSObject();r.put("connected",true);call.resolve(r);
      }catch(Exception e){try{if(socket!=null)socket.close();}catch(Exception ignored){}call.reject("Bluetooth printer not reachable: "+e.getMessage());}
    }).start();
  }

  @PluginMethod
  public void printBluetooth(PluginCall call){
    if(needsBtPermission()){ requestPermissionForAlias("btConnect",call,"printBluetoothPermissionCallback"); return; }
    String address=call.getString("address"),data=call.getString("data");
    if(address==null||data==null){call.reject("Bluetooth address and print data are required.");return;}
    new Thread(()->{
      BluetoothSocket socket=null;
      try{
        BluetoothAdapter adapter=BluetoothAdapter.getDefaultAdapter();
        BluetoothDevice device=adapter.getRemoteDevice(address);
        socket=device.createRfcommSocketToServiceRecord(SPP_UUID);
        socket.connect();
        OutputStream out=socket.getOutputStream();
        out.write(Base64.decode(data,Base64.DEFAULT));out.flush();
        Thread.sleep(250);
        out.close();socket.close();
        JSObject r=new JSObject();r.put("success",true);call.resolve(r);
      }catch(Exception e){try{if(socket!=null)socket.close();}catch(Exception ignored){} call.reject("Bluetooth print failed: "+e.getMessage());}
    }).start();
  }

  @PluginMethod
  public void testWifi(PluginCall call){
    String host=call.getString("host");Integer port=call.getInt("port",9100);
    new Thread(()->{
      Socket s=new Socket();
      try{s.connect(new InetSocketAddress(host,port),3500);s.close();JSObject r=new JSObject();r.put("connected",true);call.resolve(r);}
      catch(Exception e){try{s.close();}catch(Exception ignored){}call.reject("Wi-Fi printer not reachable: "+e.getMessage());}
    }).start();
  }

  @PluginMethod
  public void printWifi(PluginCall call){
    String host=call.getString("host"),data=call.getString("data");Integer port=call.getInt("port",9100);
    if(host==null||data==null){call.reject("Printer IP and print data are required.");return;}
    new Thread(()->{
      Socket s=new Socket();
      try{
        s.connect(new InetSocketAddress(host,port),5000);
        OutputStream out=s.getOutputStream();
        out.write(Base64.decode(data,Base64.DEFAULT));out.flush();
        Thread.sleep(250);out.close();s.close();
        JSObject r=new JSObject();r.put("success",true);call.resolve(r);
      }catch(Exception e){try{s.close();}catch(Exception ignored){}call.reject("Wi-Fi print failed: "+e.getMessage());}
    }).start();
  }
}
`;

const activity=`package in.highloops.brottta;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(NativePrinterPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
`;

fs.writeFileSync(path.join(javaDir,'NativePrinterPlugin.java'),plugin);
fs.writeFileSync(path.join(javaDir,'MainActivity.java'),activity);

const manifest=path.join(root,'android','app','src','main','AndroidManifest.xml');
let xml=fs.readFileSync(manifest,'utf8');
const perms=[
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
  '<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
];
for(const p of perms){
  if(!xml.includes(p)) xml=xml.replace('<application',p+'\\n    <application');
}
fs.writeFileSync(manifest,xml);

// Apply Brottta Android launcher icon after Capacitor creates/updates the Android project.
const iconRoot=path.join(root,'android-assets');
const resRoot=path.join(root,'android','app','src','main','res');
const densities=['mdpi','hdpi','xhdpi','xxhdpi','xxxhdpi'];
for(const density of densities){
  const fromDir=path.join(iconRoot,`mipmap-${density}`);
  const toDir=path.join(resRoot,`mipmap-${density}`);
  fs.mkdirSync(toDir,{recursive:true});
  for(const file of ['ic_launcher.png','ic_launcher_round.png']){
    const src=path.join(fromDir,file);
    if(fs.existsSync(src))fs.copyFileSync(src,path.join(toDir,file));
  }
}
// Remove Capacitor's adaptive launcher XML so Android uses the supplied branded PNG at all API levels.
const anydpi=path.join(resRoot,'mipmap-anydpi-v26');
for(const file of ['ic_launcher.xml','ic_launcher_round.xml']){
  const p=path.join(anydpi,file);
  if(fs.existsSync(p))fs.unlinkSync(p);
}

console.log('Native Bluetooth Classic + Wi-Fi printer plugin and Brottta app icon installed.');
