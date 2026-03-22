import { sessionTokenVault } from "../network/SessionTokenVault"

export class SecureTokenVault {
  static async purgeStoredCredentials(): Promise<void> {
    await sessionTokenVault.clearTokens()
  }
}
