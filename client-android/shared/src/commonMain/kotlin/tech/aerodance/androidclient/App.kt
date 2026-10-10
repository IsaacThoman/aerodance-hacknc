package tech.aerodance.androidclient

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontFamily

@Composable
fun App(
    running: Boolean = false,
    busy: Boolean = false,
    address: String = "No LAN address",
    connected: Boolean = false,
    results: Long = 0,
    error: String? = null,
    origin: String = "",
    onOriginChange: (String) -> Unit = {},
    onStart: () -> Unit = {},
    onStop: () -> Unit = {},
    fontFamily: FontFamily = FontFamily.Default,
) {
    val base = Typography()
    val typography = Typography(
        displayLarge = base.displayLarge.copy(fontFamily = fontFamily),
        displayMedium = base.displayMedium.copy(fontFamily = fontFamily),
        displaySmall = base.displaySmall.copy(fontFamily = fontFamily),
        headlineLarge = base.headlineLarge.copy(fontFamily = fontFamily),
        headlineMedium = base.headlineMedium.copy(fontFamily = fontFamily),
        headlineSmall = base.headlineSmall.copy(fontFamily = fontFamily),
        titleLarge = base.titleLarge.copy(fontFamily = fontFamily),
        titleMedium = base.titleMedium.copy(fontFamily = fontFamily),
        titleSmall = base.titleSmall.copy(fontFamily = fontFamily),
        bodyLarge = base.bodyLarge.copy(fontFamily = fontFamily),
        bodyMedium = base.bodyMedium.copy(fontFamily = fontFamily),
        bodySmall = base.bodySmall.copy(fontFamily = fontFamily),
        labelLarge = base.labelLarge.copy(fontFamily = fontFamily),
        labelMedium = base.labelMedium.copy(fontFamily = fontFamily),
        labelSmall = base.labelSmall.copy(fontFamily = fontFamily),
    )
    MaterialTheme(typography = typography) {
        Column(Modifier.fillMaxSize().safeContentPadding().padding(24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Aerodance pose controller", style = MaterialTheme.typography.headlineSmall)
            Text("Synthetic mode — camera inference is the next milestone.")
            Text(if (running) "Streaming enabled" else "Streaming stopped")
            Text(address)
            Text(if (connected) "Browser connected" else "Browser disconnected")
            Text("Completed synthetic results: $results")
            OutlinedTextField(value = origin, onValueChange = onOriginChange, enabled = !running && !busy,
                label = { Text("Allowed game origin") }, placeholder = { Text("https://your-game.example") },
                singleLine = true, modifier = Modifier.fillMaxWidth())
            Text("Enter the exact game origin, including scheme and port. No trailing path.")
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = onStart, enabled = !running && !busy) { Text("Start") }
                OutlinedButton(onClick = onStop, enabled = running && !busy) { Text("Stop") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}
