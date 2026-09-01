@echo off
REM Build the Android debug APK inside the Docker sandbox (Windows host).
REM Host needs: Node (for cap sync) + Docker. No Android SDK / JDK required.
cd /d "%~dp0.."

echo ==^> [host] Building web assets + syncing Capacitor (Node only)
call npm run build
if errorlevel 1 exit /b 1
call npx cap sync android
if errorlevel 1 exit /b 1

echo ==^> [docker] Building sandbox image (first run downloads the SDK)
docker build -t lut-android-builder -f docker\android.Dockerfile docker
if errorlevel 1 exit /b 1

echo ==^> [docker] Running Gradle assembleDebug inside the container
docker run --rm -v "%CD%:/app" -w /app/android lut-android-builder bash -c "chmod +x gradlew && ./gradlew assembleDebug --no-daemon"
if errorlevel 1 exit /b 1

echo.
echo ==^> Done! APK: %CD%\android\app\build\outputs\apk\debug\app-debug.apk
