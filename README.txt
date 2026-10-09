CLINIC APPOINTMENT BOOKING SYSTEM
Run:  python3 server.py   then open http://127.0.0.1:8000   (Python 3.9+, no installs needed)

DEMO LOGINS (fake data, delete clinic.db to reset)
  Admin:   admin@clinic.test    / admin12345
  Doctor:  doctor1@clinic.test  / doctor12345  (doctor2, doctor3 also work)
  Patient: patient@clinic.test  / patient12345

EMAIL (optional): set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM before running.
  Without them, messages are saved in the admin Notification outbox marked "not sent". SMS is a placeholder only.
Before real use: change the clinic details at the top of server.py, serve over HTTPS, add the
  Secure flag to the session cookie, and review local healthcare privacy law.
