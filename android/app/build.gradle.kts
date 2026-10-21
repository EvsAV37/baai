// «Баай» — приложение хоста: WebView с игрой + сервер для игроков по точке доступа.
// Игра (index.html, css, js, vendor) копируется из корня репозитория при каждой сборке.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val run = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "ru.evseev.baai"
    compileSdk = 34

    defaultConfig {
        applicationId = "ru.evseev.baai"
        minSdk = 23
        targetSdk = 34
        versionCode = run
        versionName = "0.3.$run"
    }

    // Постоянный ключ: новая версия ставится поверх старой, партии не теряются
    signingConfigs {
        create("baai") {
            storeFile = file("../keystore/baai.jks")
            storePassword = "baai2026"
            keyAlias = "baai"
            keyPassword = "baai2026"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("baai")
        }
        debug {
            signingConfig = signingConfigs.getByName("baai")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    lint { checkReleaseBuilds = false; abortOnError = false }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/web"))
}

val copyWeb by tasks.registering(Copy::class) {
    from(rootDir.parentFile) {
        include("index.html", "css/**", "js/**", "vendor/**")
    }
    into(layout.buildDirectory.dir("generated/web/www"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    implementation("org.java-websocket:Java-WebSocket:1.5.7")
}
