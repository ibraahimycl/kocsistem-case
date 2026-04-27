const requiredVars = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SESSION_SECRET",
];

for (const key of requiredVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  sessionSecret: process.env.SESSION_SECRET,
  nodeEnv: process.env.NODE_ENV ?? "development",
};
