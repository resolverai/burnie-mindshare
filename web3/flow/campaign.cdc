access(all) contract CampaignContract {

    access(all) struct Submission {
        access(all) let submissionString: String
        access(all) let model: String
        access(all) let llmTokensUsed: UInt64
        access(all) let submitter: Address

        init(submissionString: String, model: String, llmTokensUsed: UInt64, submitter: Address) {
            self.submissionString = submissionString
            self.model = model
            self.llmTokensUsed = llmTokensUsed
            self.submitter = submitter
        }
    }

    access(all) struct Content {
        access(all) let campaignId: UInt64
        access(all) let submission: Submission

        init(campaignId: UInt64, submission: Submission) {
            self.campaignId = campaignId
            self.submission = submission
        }
    }

    access(all) struct CampaignData {
        access(all) var status: UInt8
        access(all) var submissionIds: [UInt64]
        access(all) var winner: Address?

        init() {
            self.status = 1 // Active
            self.submissionIds = []
            self.winner = nil
        }

        access(all) fun setWinner(winner: Address) {
            self.winner = winner
        }

        access(all) fun setStatus(status: UInt8) {
            self.status = status
        }
    }

    access(all) var campaigns: {UInt64: CampaignData}
    access(all) var submissions: {UInt64: Submission}
    access(all) var totalSubmissions: {UInt64: UInt64}
    access(all) var pendingRewards: {Address: UFix64}

    access(all) var submissionCounter: UInt64
    access(all) var campaignCounter: UInt64
    access(all) var contentID: UInt64

    access(all) let totalPerBlock: UInt8
    access(all) let maxSubmissionsPerCampaign: UInt64
    access(all) let maxRewardPerCampaign: UFix64

    access(all) resource Admin {

        access(all) fun createCampaign(): UInt64 {
            CampaignContract.campaignCounter = CampaignContract.campaignCounter + 1
            let campaignId = CampaignContract.campaignCounter
            CampaignContract.campaigns[campaignId] = CampaignData()
            return campaignId
        }

        access(all) fun addSubmission(content: [Content]): [UInt64] {
            pre {
                content.length == 50: "Exactly 50 items required"
            }

            var addedIds: [UInt64] = []

            for item in content {
                let campaignId = item.campaignId

                assert(CampaignContract.campaigns.containsKey(campaignId), message: "Invalid campaign ID")
                assert(CampaignContract.campaigns[campaignId]!.status == 1, message: "Campaign not active")
                assert(CampaignContract.totalSubmissions[campaignId] ?? 0 < CampaignContract.maxSubmissionsPerCampaign, message: "Max submissions reached")

                CampaignContract.submissionCounter = CampaignContract.submissionCounter + 1
                let submissionId = CampaignContract.submissionCounter

                CampaignContract.submissions[submissionId] = item.submission
                CampaignContract.campaigns[campaignId]!.submissionIds.append(submissionId)
                CampaignContract.totalSubmissions[campaignId] = (CampaignContract.totalSubmissions[campaignId] ?? 0) + 1

                addedIds.append(submissionId)
            }

            CampaignContract.contentID = CampaignContract.contentID + 1
            return addedIds
        }

        access(all) fun selectWinners(campaignId: UInt64, winnerSubmissionId: UInt64, winner: Address) {
            let campaign = CampaignContract.campaigns[campaignId]!
            assert(campaign.status == 1, message: "Campaign not active")

            campaign.setWinner(winner: winner)
            campaign.setStatus(status: 0) // Inactive
            CampaignContract.pendingRewards[winner] = (CampaignContract.pendingRewards[winner] ?? 0.0) + CampaignContract.maxRewardPerCampaign
        }

        access(all) fun dispersePoints(campaignId: UInt64) {
            let campaign = CampaignContract.campaigns[campaignId]!
            assert(campaign.status == 0, message: "Campaign still active")
            let winner = campaign.winner!
            let reward = CampaignContract.pendingRewards[winner] ?? panic("No reward pending")

            // For now, just clear the pending reward
            // Token distribution will need to be implemented separately
            CampaignContract.pendingRewards[winner] = 0.0
        }
    }

    access(all) fun createAdmin(): @Admin {
        return <- create Admin()
    }

    init() {
        self.campaigns = {}
        self.submissions = {}
        self.totalSubmissions = {}
        self.pendingRewards = {}
        self.submissionCounter = 0
        self.campaignCounter = 0
        self.contentID = 0
        self.totalPerBlock = 50
        self.maxSubmissionsPerCampaign = 1500
        self.maxRewardPerCampaign = 100000.0
    }
}
