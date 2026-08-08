@echo off
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
echo JAVA_HOME=%JAVA_HOME%
call gradlew.bat :app:assembleDebug --console=plain --no-daemon
echo EXIT_CODE=%ERRORLEVEL%
