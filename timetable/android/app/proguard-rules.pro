# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Capacitor wires the JS bridge reflectively, so the pieces below must survive
# R8 (the release build enables minifyEnabled + shrinkResources):
#
#  - Plugins are instantiated by class name from capacitor.plugins.json and
#    their @PluginMethod members are invoked by name from JavaScript. The
#    Capacitor library ships consumer rules for this; they are repeated here so
#    this file alone documents what the app depends on.
#  - Annotation metadata must be kept, otherwise the @CapacitorPlugin /
#    @PluginMethod lookups above stop matching.
-keepattributes *Annotation*, RuntimeVisibleAnnotations, AnnotationDefault, Signature, InnerClasses, EnclosingMethod

-keep public class * extends com.getcapacitor.Plugin { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}

# Methods exposed to the WebView through addJavascriptInterface() are called by
# name from JavaScript.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Values that cross the JS bridge keep their field names.
-keep class com.getcapacitor.JSObject { *; }
-keep class com.getcapacitor.JSArray { *; }

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
