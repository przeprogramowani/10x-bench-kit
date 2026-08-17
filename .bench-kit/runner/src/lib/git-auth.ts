/**
 * Dostęp do prywatnych repo bazowych przez sekret BASE_REPO_TOKEN
 * (fine-grained PAT, contents:read) — ten sam mechanizm w CI i lokalnie.
 *
 * Zamiast trwałej konfiguracji gita: argumenty `-c url.insteadOf` doklejane
 * do każdego wywołania gita, które dotyka URL-a repo bazowego. Bez tokena
 * w env zwracamy pustą listę — repo publiczne i lokalne poświadczenia
 * użytkownika działają bez zmian.
 */
export function gitAuthArgs(): string[] {
  const token = process.env.BASE_REPO_TOKEN;
  if (!token) return [];
  const key = `url.https://x-access-token:${token}@github.com/.insteadOf`;
  // insteadOf jest wielowartościowe — drugi wpis łapie zastane URL-e SSH.
  return ["-c", `${key}=https://github.com/`, "-c", `${key}=git@github.com:`];
}
