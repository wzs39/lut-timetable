@echo off
rem Build helper: Gradle daemon needs a real JDK 17/21 (JDK 25 breaks the
rem Groovy compile phase) and capacitor-filesystem pins toolchain 21.
rem Usage: build-with-jdk.bat assembleDebug
setlocal
set "JAVA_HOME=E:\Android\jdk21\jdk-21.0.12.1+1"
set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "%~dp0"
call "%~dp0gradlew.bat" %*
