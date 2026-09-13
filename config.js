/* Public settings for the hosted board. The anon key is meant to be public: rows are protected by
   sign-in and row-level security in Supabase, not by hiding this file. */
window.BOARD_CONFIG = {
  url: "PASTE_SUPABASE_PROJECT_URL",        // like https://abcdefgh.supabase.co
  anonKey: "PASTE_SUPABASE_ANON_KEY"
};
