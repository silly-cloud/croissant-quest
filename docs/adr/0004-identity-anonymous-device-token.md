# 0004 Identity: anonymous device token
Status: accepted. First visit gets a random token in an httpOnly, SameSite=Lax cookie; the API maps it to a User row.
Covers: one person, any number of tabs on one device. Does NOT cover: the same person on a second device (no shared identity yet) or recovery after cookie loss.
Real auth is a later ADR. (The brief says "any number of devices"; without auth, cross-device sync needs an export/import code, listed as a follow-up.)
