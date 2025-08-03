# Advanced Features and Utilities for Twitter Multi-Agent System

import asyncio
import schedule
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import json
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans
from sklearn.metrics.pairwise import cosine_similarity
import pandas as pd
from textblob import TextBlob
import matplotlib.pyplot as plt
import seaborn as sns
from wordcloud import WordCloud
import networkx as nx
from collections import Counter, defaultdict
import requests
from io import BytesIO
import base64

# Advanced Analytics Module
class AdvancedAnalytics:
    def __init__(self, data_manager):
        self.data_manager = data_manager
        self.vectorizer = TfidfVectorizer(max_features=1000, stop_words='english')
    
    def analyze_content_themes(self, username: str) -> Dict:
        """Advanced thematic analysis using NLP"""
        posts = self.get_user_posts(username)
        if not posts:
            return {}
        
        texts = [post['text'] for post in posts]
        
        # TF-IDF Vectorization
        tfidf_matrix = self.vectorizer.fit_transform(texts)
        
        # Clustering for theme discovery
        n_clusters = min(5, len(texts) // 2)
        if n_clusters > 1:
            kmeans = KMeans(n_clusters=n_clusters, random_state=42)
            clusters = kmeans.fit_predict(tfidf_matrix)
            
            # Extract themes from clusters
            feature_names = self.vectorizer.get_feature_names_out()
            themes = {}
            
            for i in range(n_clusters):
                cluster_center = kmeans.cluster_centers_[i]
                top_indices = cluster_center.argsort()[-10:][::-1]
                top_words = [feature_names[idx] for idx in top_indices]
                themes[f'theme_{i}'] = {
                    'keywords': top_words,
                    'posts_count': sum(1 for c in clusters if c == i),
                    'representative_posts': [
                        texts[j] for j, c in enumerate(clusters) if c == i
                    ][:3]
                }
        
        return {
            'themes': themes,
            'total_posts_analyzed': len(texts),
            'vocabulary_size': len(feature_names),
            'content_diversity_score': self.calculate_diversity_score(tfidf_matrix)
        }
    
    def analyze_engagement_patterns(self, username: str) -> Dict:
        """Analyze engagement patterns and optimal posting times"""
        posts = self.get_user_posts(username)
        if not posts:
            return {}
        
        # Convert to DataFrame for easier analysis
        df = pd.DataFrame(posts)
        df['created_at'] = pd.to_datetime(df['created_at'])
        df['hour'] = df['created_at'].dt.hour
        df['day_of_week'] = df['created_at'].dt.dayofweek
        df['engagement_rate'] = (df['likes'] + df['retweets'] + df['replies']) / df['likes'].max()
        
        # Hourly engagement analysis
        hourly_engagement = df.groupby('hour')['engagement_rate'].mean()
        best_hours = hourly_engagement.nlargest(3).index.tolist()
        
        # Day of week analysis
        daily_engagement = df.groupby('day_of_week')['engagement_rate'].mean()
        best_days = daily_engagement.nlargest(3).index.tolist()
        
        # Content length analysis
        df['text_length'] = df['text'].str.len()
        length_engagement_corr = df['text_length'].corr(df['engagement_rate'])
        
        return {
            'optimal_posting_hours': best_hours,
            'optimal_posting_days': best_days,
            'average_engagement_by_hour': hourly_engagement.to_dict(),
            'average_engagement_by_day': daily_engagement.to_dict(),
            'text_length_correlation': length_engagement_corr,
            'recommended_text_length': self.get_optimal_text_length(df),
            'posting_frequency': len(posts) / max(1, (df['created_at'].max() - df['created_at'].min()).days)
        }
    
    def analyze_hashtag_effectiveness(self, username: str) -> Dict:
        """Analyze hashtag usage and effectiveness"""
        posts = self.get_user_posts(username)
        if not posts:
            return {}
        
        hashtag_performance = defaultdict(list)
        
        for post in posts:
            hashtags = post.get('hashtags', [])
            engagement = post.get('likes', 0) + post.get('retweets', 0) + post.get('replies', 0)
            
            if hashtags:
                for hashtag in hashtags:
                    hashtag_performance[hashtag].append(engagement)
            else:
                hashtag_performance['no_hashtags'].append(engagement)
        
        # Calculate average engagement per hashtag
        hashtag_stats = {}
        for hashtag, engagements in hashtag_performance.items():
            hashtag_stats[hashtag] = {
                'average_engagement': np.mean(engagements),
                'usage_count': len(engagements),
                'total_engagement': sum(engagements)
            }
        
        # Rank hashtags by effectiveness
        ranked_hashtags = sorted(
            hashtag_stats.items(),
            key=lambda x: x[1]['average_engagement'],
            reverse=True
        )
        
        return {
            'top_performing_hashtags': ranked_hashtags[:10],
            'hashtag_usage_frequency': Counter([h for post in posts for h in post.get('hashtags', [])]),
            'posts_with_hashtags_performance': np.mean([
                post.get('likes', 0) + post.get('retweets', 0) + post.get('replies', 0)
                for post in posts if post.get('hashtags')
            ]),
            'posts_without_hashtags_performance': np.mean([
                post.get('likes', 0) + post.get('retweets', 0) + post.get('replies', 0)
                for post in posts if not post.get('hashtags')
            ])
        }
    
    def generate_content_recommendations(self, username: str) -> Dict:
        """Generate personalized content recommendations"""
        themes = self.analyze_content_themes(username)
        engagement = self.analyze_engagement_patterns(username)
        hashtags = self.analyze_hashtag_effectiveness(username)
        
        recommendations = {
            'content_strategy': {
                'focus_themes': list(themes.get('themes', {}).keys())[:3],
                'optimal_posting_schedule': {
                    'hours': engagement.get('optimal_posting_hours', []),
                    'days': engagement.get('optimal_posting_days', [])
                },
                'recommended_hashtags': [
                    item[0] for item in hashtags.get('top_performing_hashtags', [])[:5]
                ],
                'content_length': engagement.get('recommended_text_length', 280)
            },
            'engagement_optimization': {
                'use_hashtags': hashtags.get('posts_with_hashtags_performance', 0) > 
                               hashtags.get('posts_without_hashtags_performance', 0),
                'posting_frequency': engagement.get('posting_frequency', 1),
                'content_diversity_target': min(0.8, themes.get('content_diversity_score', 0.5) + 0.1)
            }
        }
        
        return recommendations
    
    def get_user_posts(self, username: str) -> List[Dict]:
        """Helper method to fetch user posts from database"""
        # Implementation would connect to database and fetch posts
        # For now, returning placeholder
        return []
    
    def calculate_diversity_score(self, tfidf_matrix) -> float:
        """Calculate content diversity score"""
        if tfidf_matrix.shape[0] < 2:
            return 0.0
        
        # Calculate pairwise cosine similarities
        similarities = cosine_similarity(tfidf_matrix)
        
        # Average similarity (excluding diagonal)
        mask = ~np.eye(similarities.shape[0], dtype=bool)
        avg_similarity = similarities[mask].mean()
        
        # Diversity is inverse of similarity
        return 1.0 - avg_similarity
    
    def get_optimal_text_length(self, df: pd.DataFrame) -> int:
        """Determine optimal text length based on engagement"""
        # Bin text lengths and find the bin with highest average engagement
        df['length_bin'] = pd.cut(df['text_length'], bins=5)
        length_performance = df.groupby('length_bin')['engagement_rate'].mean()
        best_bin = length_performance.idxmax()
        
        # Return middle point of best performing bin
        return int(best_bin.mid)

# Automated Scheduling System
class ContentScheduler:
    def __init__(self, system, db_config):
        self.system = system
        self.db_config = db_config
        self.scheduled_jobs = {}
    
    def setup_user_schedule(self, username: str, schedule_config: Dict):
        """Setup automated posting schedule for a user"""
        analytics = AdvancedAnalytics(self.system.data_manager)
        recommendations = analytics.generate_content_recommendations(username)
        
        optimal_hours = recommendations['content_strategy']['optimal_posting_schedule']['hours']
        
        for hour in optimal_hours:
            job_id = f"{username}_{hour}"
            schedule.every().day.at(f"{hour:02d}:00").do(
                self.generate_and_queue_content, username
            ).tag(job_id)
            
            self.scheduled_jobs[job_id] = {
                'username': username,
                'hour': hour,
                'status': 'active'
            }
    
    async def generate_and_queue_content(self, username: str):
        """Generate content and queue for posting"""
        try:
            result = await self.system.create_personalized_content(username)
            
            # Store in queue table for manual review/approval
            self.queue_content_for_review(username, result)
            
            print(f"Content generated and queued for {username}")
            
        except Exception as e:
            print(f"Error generating content for {username}: {e}")
    
    def queue_content_for_review(self, username: str, content: Dict):
        """Queue generated content for human review"""
        conn = psycopg2.connect(**self.db_config)
        cur = conn.cursor()
        
        cur.execute("""
            INSERT INTO content_queue (username, content_data, status, created_at)
            VALUES (%s, %s, %s, %s)
        """, (username, json.dumps(content), 'pending_review', datetime.now()))
        
        conn.commit()
        conn.close()
    
    def run_scheduler(self):
        """Run the content scheduler"""
        while True:
            schedule.run_pending()
            time.sleep(60)  # Check every minute

# Content Quality Scorer
class QualityScorer:
    def __init__(self):
        self.criteria = {
            'authenticity': 0.25,
            'engagement_potential': 0.25,
            'relevance': 0.20,
            'clarity': 0.15,
            'originality': 0.15
        }
    
    def score_content(self, content: Dict, user_profile: Dict) -> Dict:
        """Score content quality based on multiple criteria"""
        text = content.get('text', '')
        
        scores = {
            'authenticity': self.score_authenticity(text, user_profile),
            'engagement_potential': self.score_engagement_potential(text, content),
            'relevance': self.score_relevance(text, user_profile),
            'clarity': self.score_clarity(text),
            'originality': self.score_originality(text)
        }
        
        # Calculate weighted overall score
        overall_score = sum(
            scores[criterion] * weight 
            for criterion, weight in self.criteria.items()
        )
        
        return {
            'overall_score': overall_score,
            'individual_scores': scores,
            'recommendations': self.generate_improvement_suggestions(scores)
        }
    
    def score_authenticity(self, text: str, user_profile: Dict) -> float:
        """Score how authentic the content sounds to the user's voice"""
        # Analyze text style, vocabulary, and tone
        blob = TextBlob(text)
        sentiment = blob.sentiment.polarity
        
        # Compare with user's typical sentiment range
        user_sentiment_range = user_profile.get('sentiment_range', [-0.1, 0.1])
        
        if user_sentiment_range[0] <= sentiment <= user_sentiment_range[1]:
            sentiment_score = 1.0
        else:
            sentiment_score = max(0.0, 1.0 - abs(sentiment - np.mean(user_sentiment_range)))
        
        # Vocabulary similarity (simplified)
        common_words = user_profile.get('common_vocabulary', [])
        text_words = set(text.lower().split())
        vocabulary_overlap = len(text_words.intersection(set(common_words))) / max(len(text_words), 1)
        
        return (sentiment_score + vocabulary_overlap) / 2
    
    def score_engagement_potential(self, text: str, content: Dict) -> float:
        """Score potential for engagement based on content features"""
        score = 0.0
        
        # Length optimization (Twitter sweet spot: 71-100 characters)
        length = len(text)
        if 71 <= length <= 100:
            score += 0.3
        elif 50 <= length <= 140:
            score += 0.2
        
        # Question or call-to-action
        if '?' in text or any(cta in text.lower() for cta in ['what do you think', 'agree', 'thoughts']):
            score += 0.2
        
        # Hashtags (1-2 optimal)
        hashtag_count = text.count('#')
        if 1 <= hashtag_count <= 2:
            score += 0.2
        elif hashtag_count == 0:
            score += 0.1
        
        # Media presence
        if content.get('media_specs'):
            score += 0.3
        
        return min(score, 1.0)
    
    def score_relevance(self, text: str, user_profile: Dict) -> float:
        """Score relevance to user's typical topics and themes"""
        user_topics = user_profile.get('main_topics', [])
        if not user_topics:
            return 0.5  # Neutral score if no topic data
        
        text_lower = text.lower()
        topic_matches = sum(1 for topic in user_topics if topic.lower() in text_lower)
        
        return min(topic_matches / len(user_topics), 1.0)
    
    def score_clarity(self, text: str) -> float:
        """Score content clarity and readability"""
        blob = TextBlob(text)
        
        # Basic readability metrics
        word_count = len(blob.words)
        sentence_count = len(blob.sentences)
        
        if sentence_count == 0:
            return 0.0
        
        avg_words_per_sentence = word_count / sentence_count
        
        # Optimal range: 8-15 words per sentence for social media
        if 8 <= avg_words_per_sentence <= 15:
            clarity_score = 1.0
        else:
            clarity_score = max(0.0, 1.0 - abs(avg_words_per_sentence - 11.5) / 10)
        
        # Penalize excessive punctuation or caps
        excessive_caps = sum(1 for c in text if c.isupper()) / len(text) if text else 0
        if excessive_caps > 0.3:
            clarity_score *= 0.7
        
        return clarity_score
    
    def score_originality(self, text: str) -> float:
        """Score content originality (simplified implementation)"""
        # Check for common phrases or clichés
        common_phrases = [
            'just saying', 'am i right', 'hot take', 'unpopular opinion',
            'this is why', 'let that sink in', 'change my mind'
        ]
        
        cliche_count = sum(1 for phrase in common_phrases if phrase in text.lower())
        originality_score = max(0.0, 1.0 - (cliche_count * 0.3))
        
        return originality_score
    
    def generate_improvement_suggestions(self, scores: Dict) -> List[str]:
        """Generate suggestions for improving content quality"""
        suggestions = []
        
        if scores['authenticity'] < 0.6:
            suggestions.append("Consider adjusting tone to better match your typical voice")
        
        if scores['engagement_potential'] < 0.6:
            suggestions.append("Add a question or call-to-action to increase engagement")
        
        if scores['relevance'] < 0.6:
            suggestions.append("Include topics more relevant to your audience")
        
        if scores['clarity'] < 0.6:
            suggestions.append("Simplify language for better readability")
        
        if scores['originality'] < 0.6:
            suggestions.append("Try a more unique perspective or avoid common phrases")
        
        return suggestions

# A/B Testing Framework
class ABTestFramework:
    def __init__(self, db_config):
        self.db_config = db_config
        self.setup_ab_testing_tables()
    
    def setup_ab_testing_tables(self):
        """Create tables for A/B testing"""
        conn = psycopg2.connect(**self.db_config)
        cur = conn.cursor()
        
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ab_tests (
                id SERIAL PRIMARY KEY,
                test_name VARCHAR(100) NOT NULL,
                username VARCHAR(50) NOT NULL,
                start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                end_date TIMESTAMP,
                status VARCHAR(20) DEFAULT 'active',
                test_config JSONB,
                results JSONB
            )
        """)
        
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ab_test_variants (
                id SERIAL PRIMARY KEY,
                test_id INTEGER REFERENCES ab_tests(id),
                variant_name VARCHAR(50) NOT NULL,
                content_data JSONB,
                post_id VARCHAR(50),
                performance_metrics JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        conn.commit()
        conn.close()
    
    def create_ab_test(self, test_name: str, username: str, variants: List[Dict]) -> int:
        """Create a new A/B test with multiple variants"""
        conn = psycopg2.connect(**self.db_config)
        cur = conn.cursor()
        
        # Create test
        cur.execute("""
            INSERT INTO ab_tests (test_name, username, test_config)
            VALUES (%s, %s, %s) RETURNING id
        """, (test_name, username, json.dumps({'variant_count': len(variants)})))
        
        test_id = cur.fetchone()[0]
        
        # Create variants
        for i, variant in enumerate(variants):
            cur.execute("""
                INSERT INTO ab_test_variants (test_id, variant_name, content_data)
                VALUES (%s, %s, %s)
            """, (test_id, f"variant_{i}", json.dumps(variant)))
        
        conn.commit()
        conn.close()
        
        return test_id
    
    def analyze_test_results(self, test_id: int) -> Dict:
        """Analyze A/B test results"""
        conn = psycopg2.connect(**self.db_config)
        cur = conn.cursor()
        
        cur.execute("""
            SELECT variant_name, performance_metrics
            FROM ab_test_variants
            WHERE test_id = %s AND performance_metrics IS NOT NULL
        """, (test_id,))
        
        results = cur.fetchall()
        conn.close()
        
        if not results:
            return {"status": "insufficient_data"}
        
        variant_performance = {}
        for variant_name, metrics in results:
            metrics_data = json.loads(metrics) if isinstance(metrics, str) else metrics
            variant_performance[variant_name] = metrics_data
        
        # Determine winner
        winner = max(
            variant_performance.items(),
            key=lambda x: x[1].get('engagement_rate', 0)
        )
        
        return {
            "status": "completed",
            "winner": winner[0],
            "winner_performance": winner[1],
            "all_variants": variant_performance,
            "confidence_level": self.calculate_statistical_significance(variant_performance)
        }
    
    def calculate_statistical_significance(self, variant_performance: Dict) -> float:
        """Calculate statistical significance of test results"""
        # Simplified implementation - in practice, would use proper statistical tests
        if len(variant_performance) < 2:
            return 0.0
        
        engagement_rates = [v.get('engagement_rate', 0) for v in variant_performance.values()]
        variance = np.var(engagement_rates)
        
        # Simple confidence metric based on variance
        if variance < 0.01:
            return 0.95
        elif variance < 0.05:
            return 0.80
        else:
            return 0.60

# Content Personalization Engine
class PersonalizationEngine:
    def __init__(self, llm_manager, db_config):
        self.llm_manager = llm_manager
        self.db_config = db_config
        self.user_models = {}
    
    def build_user_model(self, username: str) -> Dict:
        """Build comprehensive user model for personalization"""
        analytics = AdvancedAnalytics(None)  # Would pass proper data manager
        
        # Gather all user data
        user_model = {
            'content_themes': analytics.analyze_content_themes(username),
            'engagement_patterns': analytics.analyze_engagement_patterns(username),
            'hashtag_preferences': analytics.analyze_hashtag_effectiveness(username),
            'writing_style': self.analyze_writing_style(username),
            'audience_insights': self.analyze_audience(username),
            'temporal_patterns': self.analyze_temporal_patterns(username)
        }
        
        self.user_models[username] = user_model
        return user_model
    
    def analyze_writing_style(self, username: str) -> Dict:
        """Analyze user's writing style patterns"""
        # Get user's posts
        posts = self.get_user_posts(username)
        
        if not posts:
            return {}
        
        texts = [post['text'] for post in posts]
        
        # Analyze style metrics
        total_chars = sum(len(text) for text in texts)
        total_words = sum(len(text.split()) for text in texts)
        total_sentences = sum(len(TextBlob(text).sentences) for text in texts)
        
        style_metrics = {
            'avg_post_length': total_chars / len(texts),
            'avg_words_per_post': total_words / len(texts),
            'avg_sentences_per_post': total_sentences / len(texts),
            'avg_words_per_sentence': total_words / max(total_sentences, 1),
            'punctuation_usage': self.analyze_punctuation_patterns(texts),
            'emoji_usage': self.analyze_emoji_usage(texts),
            'formality_level': self.analyze_formality(texts),
            'sentiment_distribution': self.analyze_sentiment_distribution(texts)
        }
        
        return style_metrics
    
    def analyze_punctuation_patterns(self, texts: List[str]) -> Dict:
        """Analyze punctuation usage patterns"""
        punctuation_counts = Counter()
        total_chars = 0
        
        for text in texts:
            total_chars += len(text)
            for char in text:
                if char in '!?.,;:':
                    punctuation_counts[char] += 1
        
        return {
            'exclamation_frequency': punctuation_counts['!'] / total_chars,
            'question_frequency': punctuation_counts['?'] / total_chars,
            'comma_frequency': punctuation_counts[','] / total_chars,
            'period_frequency': punctuation_counts['.'] / total_chars
        }
    
    def analyze_emoji_usage(self, texts: List[str]) -> Dict:
        """Analyze emoji usage patterns"""
        import emoji
        
        total_emojis = 0
        emoji_types = Counter()
        
        for text in texts:
            emojis_in_text = [c for c in text if c in emoji.UNICODE_EMOJI['en']]
            total_emojis += len(emojis_in_text)
            emoji_types.update(emojis_in_text)
        
        return {
            'emoji_frequency': total_emojis / len(texts),
            'most_used_emojis': dict(emoji_types.most_common(5)),
            'emoji_diversity': len(emoji_types)
        }
    
    def analyze_formality(self, texts: List[str]) -> float:
        """Analyze formality level of writing"""
        formal_indicators = ['therefore', 'however', 'furthermore', 'consequently', 'moreover']
        informal_indicators = ['lol', 'omg', 'tbh', 'imo', 'gonna', 'wanna']
        
        formal_count = sum(
            text.lower().count(indicator) 
            for text in texts 
            for indicator in formal_indicators
        )
        
        informal_count = sum(
            text.lower().count(indicator) 
            for text in texts 
            for indicator in informal_indicators
        )
        
        if formal_count + informal_count == 0:
            return 0.5  # Neutral
        
        return formal_count / (formal_count + informal_count)
    
    def analyze_sentiment_distribution(self, texts: List[str]) -> Dict:
        """Analyze sentiment distribution across posts"""
        sentiments = [TextBlob(text).sentiment for text in texts]
        
        positive_count = sum(1 for s in sentiments if s.polarity > 0.1)
        negative_count = sum(1 for s in sentiments if s.polarity < -0.1)
        neutral_count = len(sentiments) - positive_count - negative_count
        
        return {
            'positive_ratio': positive_count / len(sentiments),
            'negative_ratio': negative_count / len(sentiments),
            'neutral_ratio': neutral_count / len(sentiments),
            'avg_polarity': np.mean([s.polarity for s in sentiments]),
            'avg_subjectivity': np.mean([s.subjectivity for s in sentiments])
        }
    
    def generate_personalized_prompt(self, username: str, content_type: str, topic: str) -> str:
        """Generate personalized prompt based on user model"""
        user_model = self.user_models.get(username, {})
        writing_style = user_model.get('writing_style', {})
        
        prompt = f"""
        Generate a {content_type} for Twitter about {topic} that matches this user's style:
        
        Writing Style:
        - Average post length: {writing_style.get('avg_post_length', 140)} characters
        - Formality level: {'formal' if writing_style.get('formality_level', 0.5) > 0.6 else 'casual'}
        - Sentiment tendency: {self.get_sentiment_tendency(writing_style)}
        - Emoji usage: {'frequent' if writing_style.get('emoji_usage', {}).get('emoji_frequency', 0) > 0.5 else 'minimal'}
        
        Engagement Patterns:
        - Preferred hashtags: {user_model.get('hashtag_preferences', {}).get('top_performing_hashtags', [])}
        - Content themes: {list(user_model.get('content_themes', {}).get('themes', {}).keys())}
        
        Make the content authentic to this user's voice while optimizing for engagement.
        """
        
        return prompt
    
    def get_sentiment_tendency(self, writing_style: Dict) -> str:
        """Determine user's sentiment tendency"""
        sentiment_dist = writing_style.get('sentiment_distribution', {})
        
        if sentiment_dist.get('positive_ratio', 0) > 0.6:
            return 'positive'
        elif sentiment_dist.get('negative_ratio', 0) > 0.4:
            return 'critical'
        else:
            return 'balanced'
    
    def get_user_posts(self, username: str) -> List[Dict]:
        """Helper method to fetch user posts"""
        # Implementation would fetch from database
        return []

# Real-time Monitoring and Alerting
class MonitoringSystem:
    def __init__(self, db_config):
        self.db_config = db_config
        self.alert_thresholds = {
            'error_rate': 0.05,
            'response_time': 30,
            'memory_usage': 0.8,
            'disk_usage': 0.9
        }
    
    async def monitor_system_health(self):
        """Continuous system health monitoring"""
        while True:
            try:
                health_metrics = await self.collect_health_metrics()
                
                # Check thresholds and send alerts
                for metric, value in health_metrics.items():
                    if metric in self.alert_thresholds:
                        threshold = self.alert_thresholds[metric]
                        if value > threshold:
                            await self.send_alert(metric, value, threshold)
                
                # Log metrics
                self.log_metrics(health_metrics)
                
                await asyncio.sleep(60)  # Check every minute
                
            except Exception as e:
                logging.error(f"Monitoring error: {e}")
                await asyncio.sleep(60)
    
    async def collect_health_metrics(self) -> Dict:
        """Collect various health metrics"""
        import psutil
        
        # System metrics
        cpu_percent = psutil.cpu_percent()
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        
        # Database metrics
        db_metrics = await self.check_database_health()
        
        # Application metrics
        app_metrics = await self.check_application_health()
        
        return {
            'cpu_usage': cpu_percent / 100,
            'memory_usage': memory.percent / 100,
            'disk_usage': disk.percent / 100,
            'database_connections': db_metrics.get('active_connections', 0),
            'response_time': app_metrics.get('avg_response_time', 0),
            'error_rate': app_metrics.get('error_rate', 0),
            'timestamp': datetime.now().isoformat()
        }
    
    async def check_database_health(self) -> Dict:
        """Check database health"""
        try:
            conn = psycopg2.connect(**self.db_config)
            cur = conn.cursor()
            
            # Check active connections
            cur.execute("SELECT count(*) FROM pg_stat_activity")
            active_connections = cur.fetchone()[0]
            
            # Check for long-running queries
            cur.execute("""
                SELECT count(*) FROM pg_stat_activity 
                WHERE state = 'active' AND now() - query_start > interval '5 minutes'
            """)
            long_queries = cur.fetchone()[0]
            
            conn.close()
            
            return {
                'active_connections': active_connections,
                'long_running_queries': long_queries,
                'status': 'healthy'
            }
        except Exception as e:
            return {'status': 'unhealthy', 'error': str(e)}
    
    async def check_application_health(self) -> Dict:
        """Check application-specific health metrics"""
        # This would integrate with your application's metrics
        # For now, returning mock data
        return {
            'avg_response_time': 2.5,
            'error_rate': 0.02,
            'active_users': 10,
            'content_generation_rate': 50
        }
    
    async def send_alert(self, metric: str, value: float, threshold: float):
        """Send alert when threshold is exceeded"""
        alert_message = f"Alert: {metric} = {value:.2f} exceeds threshold {threshold:.2f}"
        
        # Here you would integrate with your alerting system
        # (email, Slack, Discord, etc.)
        logging.warning(alert_message)
        
        # Store alert in database
        conn = psycopg2.connect(**self.db_config)
        cur = conn.cursor()
        
        cur.execute("""
            INSERT INTO alerts (metric_name, value, threshold, message, created_at)
            VALUES (%s, %s, %s, %s, %s)
        """, (metric, value, threshold, alert_message, datetime.now()))
        
        conn.commit()
        conn.close()
    
    def log_metrics(self, metrics: Dict):
        """Log metrics to database for historical analysis"""
        conn = psycopg2.connect(**self.db_config)
        cur = conn.cursor()
        
        cur.execute("""
            INSERT INTO system_metrics (metrics_data, created_at)
            VALUES (%s, %s)
        """, (json.dumps(metrics), datetime.now()))
        
        conn.commit()
        conn.close()

# Usage Example: Bringing it all together
class EnhancedTwitterMultiAgentSystem:
    def __init__(self, config_file: str):
        # Load base system
        from twitter_multi_agent_system import TwitterMultiAgentSystem
        self.base_system = TwitterMultiAgentSystem(config_file)
        
        # Initialize enhanced components
        self.analytics = AdvancedAnalytics(self.base_system.data_manager)
        self.scheduler = ContentScheduler(self.base_system, self.base_system.config["database"])
        self.quality_scorer = QualityScorer()
        self.ab_testing = ABTestFramework(self.base_system.config["database"])
        self.personalization = PersonalizationEngine(
            self.base_system.content_flow.llm_manager, 
            self.base_system.config["database"]
        )
        self.monitoring = MonitoringSystem(self.base_system.config["database"])
    
    async def enhanced_content_creation(self, username: str) -> Dict:
        """Enhanced content creation with quality scoring and personalization"""
        
        # Build user model for personalization
        user_model = self.personalization.build_user_model(username)
        
        # Generate content using base system
        base_result = await self.base_system.create_personalized_content(username)
        
        # Score content quality
        quality_scores = []
        for post in base_result.get('final_posts', []):
            score = self.quality_scorer.score_content(post, user_model)
            quality_scores.append(score)
            post['quality_score'] = score
        
        # Filter high-quality content
        high_quality_posts = [
            post for post in base_result.get('final_posts', [])
            if post.get('quality_score', {}).get('overall_score', 0) >= 0.7
        ]
        
        return {
            'username': username,
            'user_model': user_model,
            'all_posts': base_result.get('final_posts', []),
            'high_quality_posts': high_quality_posts,
            'average_quality_score': np.mean([
                post.get('quality_score', {}).get('overall_score', 0) 
                for post in base_result.get('final_posts', [])
            ]),
            'recommendations': self.analytics.generate_content_recommendations(username)
        }
    
    async def run_ab_test(self, username: str, test_name: str, num_variants: int = 2) -> int:
        """Run A/B test with multiple content variants"""
        
        # Generate multiple variants
        variants = []
        for i in range(num_variants):
            result = await self.base_system.create_personalized_content(username)
            variants.append(result.get('final_posts', [{}])[0])
        
        # Create A/B test
        test_id = self.ab_testing.create_ab_test(test_name, username, variants)
        
        return test_id
    
    async def start_monitoring(self):
        """Start system monitoring"""
        await self.monitoring.monitor_system_health()

# Example usage
if __name__ == "__main__":
    async def main():
        system = EnhancedTwitterMultiAgentSystem('config.json')
        
        # Enhanced content creation
        result = await system.enhanced_content_creation('example_user')
        print(f"Generated {len(result['high_quality_posts'])} high-quality posts")
        
        # Run A/B test
        test_id = await system.run_ab_test('example_user', 'engagement_test', 3)
        print(f"Started A/B test with ID: {test_id}")
        
        # Start monitoring (would run in background)
        # await system.start_monitoring()
    
    asyncio.run(main())