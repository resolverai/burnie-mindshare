import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './User';
import { ContentMarketplace } from './ContentMarketplace';

export enum BidCurrency {
  ROAST = 'ROAST',
  USDC = 'USDC',
  KAITO = 'KAITO',
  COOKIE = 'COOKIE',
  AXR = 'AXR',
  NYKO = 'NYKO',
}

@Entity('bidding_system')
@Index(['contentId', 'bidAmount'])
@Index(['bidderId'])
@Index(['isWinning'])
export class BiddingSystem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer' })
  contentId!: number;

  @Column({ type: 'integer' })
  bidderId!: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  bidAmount!: number;

  @Column({
    type: 'enum',
    enum: BidCurrency,
    default: BidCurrency.ROAST,
  })
  bidCurrency!: BidCurrency;

  @Column({ type: 'boolean', default: false })
  isWinning!: boolean;

  @Column({ type: 'boolean', default: false })
  hasWon!: boolean; // True when auction ends and this is the winning bid

  @Column({ type: 'timestamp', nullable: true })
  wonAt?: Date | null; // When this bid won the auction

  // Relations
  @ManyToOne(() => ContentMarketplace, content => content.id)
  @JoinColumn({ name: 'contentId' })
  content!: ContentMarketplace;

  @ManyToOne(() => User, user => user.id)
  @JoinColumn({ name: 'bidderId' })
  bidder!: User;

  @CreateDateColumn()
  createdAt!: Date;

  // Helper methods
  getBidAmount(): number {
    return Number(this.bidAmount);
  }

  isROASTBid(): boolean {
    return this.bidCurrency === BidCurrency.ROAST;
  }

  isUSDCBid(): boolean {
    return this.bidCurrency === BidCurrency.USDC;
  }

  setAsWinning(): void {
    this.isWinning = true;
  }

  setAsLosing(): void {
    this.isWinning = false;
  }

  // Convert bid to USD equivalent for comparison (mock rates)
  getBidValueInUSD(): number {
    const mockRates = {
      ROAST: 0.1,  // $0.10 per ROAST
      USDC: 1.0,   // $1.00 per USDC
      KAITO: 0.25, // $0.25 per KAITO
      COOKIE: 0.15, // $0.15 per COOKIE
      AXR: 0.08,   // $0.08 per AXR
      NYKO: 0.12,  // $0.12 per NYKO
    };
    
    return this.getBidAmount() * mockRates[this.bidCurrency];
  }

  canAffordBid(user: User): boolean {
    const balance = this.bidCurrency === BidCurrency.ROAST 
      ? user.roastBalance 
      : user.usdcBalance;
    
    return Number(balance) >= this.getBidAmount();
  }

  getTimeElapsed(): number {
    return Date.now() - this.createdAt.getTime();
  }

  getFormattedBid(): string {
    return `${this.getBidAmount().toLocaleString()} ${this.bidCurrency}`;
  }
} 