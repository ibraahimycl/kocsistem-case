export function isSupabaseNetworkError(error) {
  const message = String(error?.message ?? "");
  const code = String(error?.cause?.code ?? error?.code ?? "");

  return (
    /fetch failed/i.test(message) ||
    /getaddrinfo/i.test(message) ||
    /enotfound/i.test(message) ||
    /enotfound/i.test(code)
  );
}

export function getSupabaseNetworkErrorMessage() {
  return "Supabase baglantisi kurulamadi. SUPABASE_URL ve SUPABASE_ANON_KEY ayni projeye ait olmali.";
}
