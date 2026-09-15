/**
 * Runs once when the Next.js server boots (dev and production Node runtime).
 * Anchors the process to the hotel's timezone so check-in/out policy times are
 * always computed in local hotel time.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (!process.env.TZ) {
      process.env.TZ = 'Asia/Dhaka'
    }
  }
}
