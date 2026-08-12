import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { LockScreen } from './components/LockScreen.jsx'
import { isNative, isAndroid } from './utils/platform.js'
import { initNativeStorage } from './utils/storage.js'
import * as secureStore from './utils/secureStore.js'
import './index.css'

/**
 * Initialise Capacitor plugins when running on a native device.
 * Called once before the React tree mounts so that the StatusBar
 * and Keyboard are configured immediately, and native storage
 * is pre-loaded into the in-memory cache.
 */
async function initCapacitor() {
  if (!isNative) return;

  // Pre-load native storage into the synchronous in-memory cache
  await initNativeStorage();

  // StatusBar — dark content, transparent overlay so content extends behind it
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0d0d14' });
    if (isAndroid) {
      await StatusBar.setOverlaysWebView({ overlay: true });
    }
  } catch (err) {
    console.warn('[OpenChat] StatusBar init failed:', err);
  }

  // Keyboard — resize mode is handled via capacitor.config.js
  // No additional runtime init needed.

  // Add 'native' class to body for CSS targeting
  document.body.classList.add('native');
  if (isAndroid) document.body.classList.add('android');
}

/** Render the app, or the lock screen first when local data is encrypted. */
async function bootstrap() {
  await initCapacitor();

  // Preload encrypted blobs so we can decide whether a passphrase is needed.
  await secureStore.initSecureStore();
  const locked = secureStore.isEnabled() && !secureStore.isUnlocked();

  const root = ReactDOM.createRoot(document.getElementById('root'));

  function UnlockGate() {
    const [unlocked, setUnlocked] = useState(!locked);
    return (
      <>
        {unlocked ? (
          <App />
        ) : (
          <LockScreen
            onUnlock={async (passphrase) => {
              try {
                await secureStore.unlock(passphrase);
                setUnlocked(true);
                return true;
              } catch {
                return false;
              }
            }}
          />
        )}
      </>
    );
  }

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <UnlockGate />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

bootstrap();
