package tech.aerodance.androidclient

interface Platform {
    val name: String
}

expect fun getPlatform(): Platform