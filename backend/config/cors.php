<?php
/**
 * Shared CORS configuration for local development.
 *
 * Allows the Ionic dev server (localhost:8100), any localhost/LAN port, and
 * the Capacitor/ionic WebView origins. Preflight requests are answered here.
 */

$origin = $_SERVER["HTTP_ORIGIN"] ?? "";

$isDevOrigin = $origin !== "" && (
    preg_match(
        '#^https?://(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$#',
        $origin
    ) === 1
    || in_array($origin, ["capacitor://localhost", "ionic://localhost", "https://localhost"], true)
);

if ($isDevOrigin) {
    header("Access-Control-Allow-Origin: " . $origin);
    header("Access-Control-Allow-Credentials: true");
    header("Vary: Origin");
    header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization");
    header("Access-Control-Max-Age: 86400");
}
// Unknown origins receive no CORS headers, so browsers block them.
// Non-browser clients (curl/Postman) send no Origin and are unaffected.
header("Content-Type: application/json; charset=UTF-8");

if (($_SERVER["REQUEST_METHOD"] ?? "") === "OPTIONS") {
    http_response_code(200);
    exit();
}