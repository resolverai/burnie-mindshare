access(all) contract RoastPoints {

    access(all) var totalSupply: UFix64

    access(all) resource Vault {
        access(self) var balance: UFix64

        init(balance: UFix64) {
            self.balance = balance
        }

        access(all) fun deposit(from: @Vault) {
            let vault <- from as! @Vault
            self.balance = self.balance + vault.balance
            destroy vault
        }

        access(all) fun withdraw(amount: UFix64): @Vault {
            pre {
                self.balance >= amount: "Insufficient balance"
            }
            self.balance = self.balance - amount
            return <- create Vault(balance: amount)
        }

        access(all) fun getBalance(): UFix64 {
            return self.balance
        }
    }

    access(all) fun createEmptyVault(): @Vault {
        return <- create Vault(balance: 0.0)
    }

    access(account) fun mintTokens(amount: UFix64, recipient: &Vault) {
        self.totalSupply = self.totalSupply + amount
        recipient.deposit(from: <- create Vault(balance: amount))
    }

    init() {
        self.totalSupply = 0.0
        let vault <- create Vault(balance: 0.0)
        self.account.storage.save(<-vault, to: /storage/RoastPointsVault)
        self.account.capabilities.storage.issue<&Vault>(
            /storage/RoastPointsVault
        )
    }
}
