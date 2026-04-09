// ─────────────────────────────────────────────────────────────────────
// FLUTTER SIDE: Add this to your Flutter app to send errors to Sentry.
// This file goes in your Flutter repo, NOT in the agent repo.
// ─────────────────────────────────────────────────────────────────────
//
// 1. Add dependency:
//    flutter pub add sentry_flutter
//
// 2. Replace your main.dart with this pattern:

import 'package:flutter/widgets.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'app.dart'; // your actual app widget

Future<void> main() async {
  await SentryFlutter.init(
    (options) {
      options.dsn = 'https://YOUR_KEY@o0.ingest.sentry.io/YOUR_PROJECT_ID';

      // ── Recommended settings ──
      options.tracesSampleRate = 1.0;           // 100% for dev, lower in prod
      options.attachScreenshot = true;           // attach screenshots to errors
      options.attachViewHierarchy = true;        // send widget tree
      options.enableAutoPerformanceTracing = true;
      options.environment = const String.fromEnvironment(
        'ENV',
        defaultValue: 'development',
      );

      // ── Debug symbols (for readable stack traces) ──
      // Run after build:
      //   flutter build apk --obfuscate --split-debug-info=build/debug-info
      //   sentry-cli upload-dif --org YOUR_ORG --project YOUR_PROJECT build/debug-info/
    },
    appRunner: () => runApp(const MyApp()),
  );
}

// ─────────────────────────────────────────────────────────────────────
// MANUAL ERROR REPORTING (optional, for caught exceptions)
// ─────────────────────────────────────────────────────────────────────

/// Call this in catch blocks for errors you handle but still want tracked:
///
///   try {
///     await riskyOperation();
///   } catch (e, stackTrace) {
///     reportError(e, stackTrace);
///     // handle gracefully...
///   }
Future<void> reportError(dynamic exception, StackTrace stackTrace) async {
  await Sentry.captureException(exception, stackTrace: stackTrace);
}

// ─────────────────────────────────────────────────────────────────────
// USER CONTEXT (optional, helps debugging)
// ─────────────────────────────────────────────────────────────────────

/// Call after login to attach user info to all future events:
///
///   setSentryUser(userId: 'u_123', email: 'user@example.com');
void setSentryUser({required String userId, String? email}) {
  Sentry.configureScope((scope) {
    scope.setUser(SentryUser(id: userId, email: email));
  });
}
