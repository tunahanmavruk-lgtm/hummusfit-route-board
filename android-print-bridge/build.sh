#!/bin/sh
set -eu

BRIDGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SDK_ROOT=${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}
JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home}
export JAVA_HOME
TOOLS="$SDK_ROOT/build-tools/35.0.0"
ANDROID_JAR="$SDK_ROOT/platforms/android-34/android.jar"
BUILD="$BRIDGE_DIR/build"
SIGNING="$BRIDGE_DIR/.signing"

mkdir -p "$BUILD/classes" "$BUILD/dex" "$SIGNING"
"$JAVA_HOME/bin/javac" --release 8 -Xlint:-options -cp "$ANDROID_JAR" -d "$BUILD/classes" \
  "$BRIDGE_DIR/src/com/hummusfit/autoprint/MainActivity.java"
"$JAVA_HOME/bin/jar" cf "$BUILD/classes.jar" -C "$BUILD/classes" .
"$TOOLS/d8" --lib "$ANDROID_JAR" --min-api 26 --output "$BUILD/dex" "$BUILD/classes.jar"
"$TOOLS/aapt2" link -I "$ANDROID_JAR" --manifest "$BRIDGE_DIR/AndroidManifest.xml" \
  --min-sdk-version 26 --target-sdk-version 28 -o "$BUILD/base.apk"
(cd "$BUILD/dex" && zip -q -j "$BUILD/base.apk" classes.dex)
"$TOOLS/zipalign" -f 4 "$BUILD/base.apk" "$BUILD/aligned.apk"

if [ ! -f "$SIGNING/hf-autoprint.jks" ]; then
  "$JAVA_HOME/bin/keytool" -genkeypair -alias hf-autoprint -keyalg RSA -keysize 2048 \
    -validity 3650 -keystore "$SIGNING/hf-autoprint.jks" -storepass android \
    -keypass android -dname 'CN=Hummus Fit Auto Print'
fi
"$TOOLS/apksigner" sign --ks "$SIGNING/hf-autoprint.jks" --ks-key-alias hf-autoprint \
  --ks-pass pass:android --key-pass pass:android --out "$BUILD/hf-auto-print.apk" "$BUILD/aligned.apk"
"$TOOLS/apksigner" verify "$BUILD/hf-auto-print.apk"
echo "$BUILD/hf-auto-print.apk"
