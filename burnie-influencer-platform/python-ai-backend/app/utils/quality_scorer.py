import re
from typing import Dict, Any

class QualityScorer:
    """Utility for scoring content quality"""
    
    def score_content(self, content: str, campaign_context: Dict[str, Any] = None) -> Dict[str, float]:
        """Score content quality on multiple factors"""
        scores = {
            "engagement_potential": self._score_engagement_potential(content),
            "relevance_score": self._score_relevance(content, campaign_context),
            "clarity_score": self._score_clarity(content),
            "originality_score": self._score_originality(content),
            "brand_alignment": self._score_brand_alignment(content, campaign_context)
        }
        
        # Calculate overall quality as weighted average
        weights = {
            "engagement_potential": 0.3,
            "relevance_score": 0.25,
            "clarity_score": 0.2,
            "originality_score": 0.15,
            "brand_alignment": 0.1
        }
        
        overall_quality = sum(scores[key] * weights[key] for key in scores.keys())
        scores["overall_quality"] = overall_quality
        
        return scores
    
    def _score_engagement_potential(self, content: str) -> float:
        """Score based on engagement factors"""
        score = 50.0  # Base score
        
        # Length optimization (160-220 chars optimal for Twitter)
        length = len(content)
        if 160 <= length <= 220:
            score += 15
        elif 120 <= length <= 280:
            score += 10
        else:
            score += 5
        
        # Emoji usage
        emoji_count = len(re.findall(r'[\U0001f600-\U0001f64f]|[\U0001f300-\U0001f5ff]|[\U0001f680-\U0001f6ff]|[\U0001f1e0-\U0001f1ff]', content))
        if 1 <= emoji_count <= 3:
            score += 10
        elif emoji_count > 0:
            score += 5
        
        # Hashtag usage
        hashtag_count = len(re.findall(r'#\w+', content))
        if 2 <= hashtag_count <= 4:
            score += 10
        elif hashtag_count > 0:
            score += 5
        
        # Question marks (engagement drivers)
        if '?' in content:
            score += 5
        
        # Exclamation points (moderate usage)
        exclamation_count = content.count('!')
        if 1 <= exclamation_count <= 2:
            score += 5
        
        return min(score, 100.0)
    
    def _score_relevance(self, content: str, campaign_context: Dict[str, Any] = None) -> float:
        """Score content relevance to campaign/crypto space"""
        score = 60.0  # Base score
        
        if not campaign_context:
            return score
        
        # Check for campaign-specific keywords
        campaign_keywords = []
        if 'title' in campaign_context:
            campaign_keywords.extend(campaign_context['title'].lower().split())
        if 'description' in campaign_context:
            campaign_keywords.extend(campaign_context['description'].lower().split())
        
        content_lower = content.lower()
        keyword_matches = sum(1 for keyword in campaign_keywords if keyword in content_lower)
        if keyword_matches > 0:
            score += min(keyword_matches * 10, 30)
        
        # Crypto/Web3 relevance
        crypto_keywords = ['crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'defi', 'web3', 'blockchain', 'nft', 'dao', 'degen', 'trading', 'ai']
        crypto_matches = sum(1 for keyword in crypto_keywords if keyword in content_lower)
        if crypto_matches > 0:
            score += min(crypto_matches * 5, 20)
        
        return min(score, 100.0)
    
    def _score_clarity(self, content: str) -> float:
        """Score content clarity and readability"""
        score = 70.0  # Base score
        
        # Sentence structure
        sentences = content.split('.')
        avg_sentence_length = sum(len(s.split()) for s in sentences) / len(sentences) if sentences else 0
        
        if 8 <= avg_sentence_length <= 15:
            score += 15
        elif 5 <= avg_sentence_length <= 20:
            score += 10
        
        # Readability factors
        words = content.split()
        if words:
            avg_word_length = sum(len(word) for word in words) / len(words)
            if 4 <= avg_word_length <= 6:
                score += 10
        
        # Proper capitalization
        if content and content[0].isupper():
            score += 5
        
        return min(score, 100.0)
    
    def _score_originality(self, content: str) -> float:
        """Score content originality"""
        score = 75.0  # Base score
        
        # Check for unique elements
        unique_phrases = ['just', 'imagine', 'pov:', 'plot twist', 'breaking:', 'reminder:']
        if any(phrase in content.lower() for phrase in unique_phrases):
            score += 10
        
        # Creative punctuation or formatting
        if '...' in content or '→' in content or '↗️' in content:
            score += 5
        
        # Avoid generic phrases
        generic_phrases = ['this is huge', 'to the moon', 'diamond hands', 'wen moon']
        generic_count = sum(1 for phrase in generic_phrases if phrase in content.lower())
        if generic_count > 0:
            score -= generic_count * 5
        
        return max(min(score, 100.0), 20.0)
    
    def _score_brand_alignment(self, content: str, campaign_context: Dict[str, Any] = None) -> float:
        """Score brand alignment with campaign guidelines"""
        score = 80.0  # Base score
        
        if not campaign_context or 'brand_guidelines' not in campaign_context:
            return score
        
        guidelines = campaign_context['brand_guidelines'].lower()
        content_lower = content.lower()
        
        # Check tone alignment
        if 'professional' in guidelines and not any(word in content_lower for word in ['lol', 'omg', 'wtf']):
            score += 10
        elif 'casual' in guidelines and any(word in content_lower for word in ['hey', 'yo', 'sup']):
            score += 10
        elif 'humorous' in guidelines and any(word in content_lower for word in ['lol', '😂', 'joke', 'funny']):
            score += 10
        
        # Check formality
        if 'formal' in guidelines and content[0].isupper() and '!' not in content:
            score += 5
        elif 'informal' in guidelines and ('!' in content or '?' in content):
            score += 5
        
        return min(score, 100.0) 