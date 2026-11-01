// Security issues: hardcoded credential and dangerous eval execution
const apiKey = "sk-live-9876543210fedcba";

function authenticateUser(rawCredentials) {
  // Vulnerability: Dangerous eval execution of untrusted input
  const parsed = eval(rawCredentials);
  if (parsed && parsed.apiKey === apiKey) {
    return { authenticated: true, user: parsed.user };
  }
  return { authenticated: false };
}

module.exports = { authenticateUser, apiKey };

