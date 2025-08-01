from datetime import datetime
from typing import Dict, Optional
import logging
from app.models.content_generation import MiningSession

logger = logging.getLogger(__name__)

class ProgressTracker:
    """
    Manages mining session progress and real-time status tracking
    """
    
    def __init__(self):
        self.active_sessions: Dict[str, MiningSession] = {}
        self.session_history: Dict[str, MiningSession] = {}
    
    def add_session(self, session_id: str, mining_session: MiningSession) -> None:
        """Add a new mining session to track"""
        try:
            self.active_sessions[session_id] = mining_session
            logger.info(f"📊 Added session {session_id} to progress tracker")
        except Exception as e:
            logger.error(f"❌ Error adding session {session_id}: {e}")
    
    def get_session(self, session_id: str) -> Optional[MiningSession]:
        """Get a mining session by ID"""
        return self.active_sessions.get(session_id)
    
    def update_session_progress(self, session_id: str, progress: int, step: str) -> bool:
        """Update session progress"""
        try:
            if session_id in self.active_sessions:
                session = self.active_sessions[session_id]
                session.progress = progress
                session.current_step = step
                return True
            return False
        except Exception as e:
            logger.error(f"❌ Error updating session progress: {e}")
            return False
    
    def complete_session(self, session_id: str, result: dict) -> bool:
        """Mark session as completed and archive"""
        try:
            if session_id in self.active_sessions:
                session = self.active_sessions[session_id]
                session.status = "completed"
                session.progress = 100
                session.completed_at = datetime.utcnow()
                session.generated_content = result
                
                # Move to history
                self.session_history[session_id] = session
                del self.active_sessions[session_id]
                
                logger.info(f"✅ Completed session {session_id}")
                return True
            return False
        except Exception as e:
            logger.error(f"❌ Error completing session: {e}")
            return False
    
    def error_session(self, session_id: str, error: str) -> bool:
        """Mark session as errored"""
        try:
            if session_id in self.active_sessions:
                session = self.active_sessions[session_id]
                session.status = "error"
                session.error = error
                
                # Move to history
                self.session_history[session_id] = session
                del self.active_sessions[session_id]
                
                logger.error(f"❌ Session {session_id} errored: {error}")
                return True
            return False
        except Exception as e:
            logger.error(f"❌ Error setting session error: {e}")
            return False
    
    def get_all_sessions(self) -> Dict[str, MiningSession]:
        """Get all active sessions"""
        return self.active_sessions.copy()
    
    def get_user_sessions(self, user_id: int) -> Dict[str, MiningSession]:
        """Get all sessions for a specific user"""
        user_sessions = {}
        for session_id, session in self.active_sessions.items():
            if session.user_id == user_id:
                user_sessions[session_id] = session
        return user_sessions
    
    def cleanup_old_sessions(self, max_age_hours: int = 24) -> int:
        """Clean up old sessions from memory"""
        try:
            current_time = datetime.utcnow()
            expired_sessions = []
            
            for session_id, session in self.active_sessions.items():
                age_hours = (current_time - session.started_at).total_seconds() / 3600
                if age_hours > max_age_hours:
                    expired_sessions.append(session_id)
            
            # Move expired sessions to history
            for session_id in expired_sessions:
                session = self.active_sessions[session_id]
                session.status = "expired"
                self.session_history[session_id] = session
                del self.active_sessions[session_id]
            
            logger.info(f"🧹 Cleaned up {len(expired_sessions)} expired sessions")
            return len(expired_sessions)
            
        except Exception as e:
            logger.error(f"❌ Error cleaning up sessions: {e}")
            return 0
    
    def get_session_stats(self) -> dict:
        """Get overall session statistics"""
        try:
            active_count = len(self.active_sessions)
            completed_count = len([s for s in self.session_history.values() if s.status == "completed"])
            error_count = len([s for s in self.session_history.values() if s.status == "error"])
            
            return {
                "active_sessions": active_count,
                "completed_sessions": completed_count,
                "error_sessions": error_count,
                "total_sessions": active_count + len(self.session_history),
                "success_rate": completed_count / (completed_count + error_count) * 100 if (completed_count + error_count) > 0 else 0
            }
        except Exception as e:
            logger.error(f"❌ Error getting session stats: {e}")
            return {
                "active_sessions": 0,
                "completed_sessions": 0,
                "error_sessions": 0,
                "total_sessions": 0,
                "success_rate": 0
            } 