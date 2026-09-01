# Android APK build sandbox — keeps the Android SDK + JDK inside a
# container so the host never needs them installed.
#
# Build:   docker build -t lut-android-builder -f android.Dockerfile .
# Usage:   ./build-android.sh   (Linux/macOS)  or  build-android.bat (Windows)
#
# The container only runs Gradle; `npx cap sync android` runs on the host
# (needs only Node) so the image stays lean.

FROM eclipse-temurin:21-jdk

ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# Command-line tools (pin a known-good version; bump when needed)
RUN apt-get update && apt-get install -y --no-install-recommends wget unzip \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p $ANDROID_HOME/cmdline-tools \
    && wget -q https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
       -O /tmp/cmdtools.zip \
    && unzip -q /tmp/cmdtools.zip -d $ANDROID_HOME/cmdline-tools \
    && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
    && rm /tmp/cmdtools.zip

# Accept licenses + install the SDK pieces the project needs
# (compileSdk 36 from timetable/android/variables.gradle)
RUN yes | sdkmanager --licenses > /dev/null 2>&1 \
    && sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" > /dev/null

WORKDIR /app
CMD ["/bin/bash"]
