plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.ivyea.sayday.infer"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    // 模型 122MB：不压缩，安装后拷贝更快
    androidResources {
        noCompress += "onnx"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.27.0")
    // 听学的后台播放：ExoPlayer + 媒体会话（通知栏 / 锁屏 / 耳机按键、音频焦点）。
    // 1.8.0 只依赖 androidx.core 1.8 这一档、Kotlin BOM 1.8，和 Tauri 2.11 模板的 Kotlin 版本兼容；升级前先看依赖会不会把 kotlin-stdlib 拉到 2.x
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-session:1.8.0")
    implementation(project(":tauri-android"))
}
