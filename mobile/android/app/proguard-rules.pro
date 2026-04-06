# PAGIR 2 ProGuard rules

# React Native
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-dontwarn com.facebook.**

# React Native crypto
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# SQLite / op-sqlite
-keep class com.op.sqlite.** { *; }

# BLE
-keep class no.nordicsemi.android.** { *; }

# Kotlin
-keep class kotlin.** { *; }
-dontwarn kotlin.**

# Keep source line numbers for crash reports
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
