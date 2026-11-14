#!/usr/bin/env bash
# 字形工坊安卓版构建（无 Gradle）：aapt2 compile -> link -> javac -> d8 -> zip -> align -> sign
# 用法: bash build.sh
set -e

cd "$(cd "$(dirname "$0")" && pwd)"   # android/

SDK="${ANDROID_SDK:-E:/AndroidSDK}"
BT="$SDK/build-tools/34.0.0"
P19="$SDK/platforms/android-19/android.jar"
P34="$SDK/platforms/android-34/android.jar"
JAVA_DIR="${JAVA_HOME:-C:/Java/jdk-26.0.2+10}"
JAVAC="$JAVA_DIR/bin/javac"
KEYTOOL="$JAVA_DIR/bin/keytool"
JAVA="$JAVA_DIR/bin/java"
if [ -f "$SDK/cmdline-tools/latest/lib/r8.jar" ]; then
  D8JAR="$SDK/cmdline-tools/latest/lib/r8.jar"
else
  D8JAR="$BT/lib/d8.jar"
fi
PY="C:/Users/LCJ/.workbuddy/binaries/python/envs/default/Scripts/python.exe"

NAME="FontStudio"
OUT="build"
KS="keystore/fontstudio.jks"
KSPASS="fontstudio2026"
ALIAS="fontstudio"
ROOT=".."   # 项目根（index.html / js / css 所在）

echo "==> 0/8 clean & sync assets"
rm -rf "$OUT"
if [ -d "$OUT.old" ]; then mv "$OUT.old" /tmp/fs_build_trash 2>/dev/null || true; fi
mkdir -p "$OUT/classes" "$OUT/dex" assets
# 同步网页内核到 assets
cp "$ROOT/index.html" assets/
rm -rf assets/js assets/css
cp -r "$ROOT/js" assets/js
cp -r "$ROOT/css" assets/css

echo "==> 1/8 aapt2 compile (res)"
"$BT/aapt2.exe" compile --dir res -o "$OUT/res.zip"

echo "==> 2/8 aapt2 link"
"$BT/aapt2.exe" link \
  -o "$OUT/base.apk" \
  -I "$P34" \
  --manifest AndroidManifest.xml \
  -R "$OUT/res.zip" \
  -A assets \
  --java "$OUT/gen" \
  --min-sdk-version 19 \
  --target-sdk-version 28 \
  --version-code 6 \
  --version-name 0.1.5 \
  --auto-add-overlay

echo "==> 3/8 javac (against android-19)"
find src -name '*.java' > "$OUT/sources.txt"
"$JAVAC" --release 8 -encoding UTF-8 -Xlint:-options \
  -classpath "$P19" -d "$OUT/classes" "@$OUT/sources.txt"

echo "==> 4/8 d8 (min-api 19)"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$JAVA" -cp "$D8JAR" com.android.tools.r8.D8 \
  --min-api 19 --lib "$P34" --output "$OUT/dex" "@$OUT/classes.txt"

echo "==> 5/8 add classes.dex"
"$PY" - "$OUT/base.apk" "$OUT/dex/classes.dex" <<'PY'
import sys, zipfile, shutil, os
apk, dex = sys.argv[1], sys.argv[2]
tmp = apk + ".tmp"
shutil.copyfile(apk, tmp)
with zipfile.ZipFile(tmp, "a", zipfile.ZIP_DEFLATED) as z:
    z.write(dex, "classes.dex")
os.replace(tmp, apk)
print("    classes.dex =", os.path.getsize(dex), "bytes")
PY

echo "==> 6/8 zipalign"
"$BT/zipalign.exe" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"

echo "==> 7/8 apksigner (v1 for API 19)"
if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  "$KEYTOOL" -genkeypair -v -keystore "$KS" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10950 -storetype PKCS12 \
    -storepass "$KSPASS" -keypass "$KSPASS" \
    -dname "CN=Font Studio,O=LCJ,C=CN" >/dev/null 2>&1
  echo "    keystore created: $KS"
fi
"$JAVA" -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KS" --ks-pass "pass:$KSPASS" --key-pass "pass:$KSPASS" \
  --min-sdk-version 19 --v1-signing-enabled true --v2-signing-enabled true \
  --out "$NAME-v0.1.5.apk" "$OUT/aligned.apk"

echo "==> 8/8 verify"
"$JAVA" -jar "$BT/lib/apksigner.jar" verify --min-sdk-version 19 --print-certs "$NAME-v0.1.5.apk" 2>/dev/null | head -6
"$BT/aapt2.exe" dump badging "$NAME-v0.1.5.apk" | head -5
ls -l "$NAME-v0.1.5.apk"
echo "==> DONE"
