// Trusted, immutable lifecycle helper. Untrusted code is only docker exec'd as UID 65532.
const seconds = Number(process.argv[2]);
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 7500) process.exit(64);
const timer = setInterval(() => {}, 1000);
setTimeout(() => { clearInterval(timer); process.exit(124); }, seconds * 1000);
