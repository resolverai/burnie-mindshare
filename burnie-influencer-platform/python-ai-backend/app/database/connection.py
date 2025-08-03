import logging
from sqlalchemy import create_engine, MetaData
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

from app.config.settings import settings

logger = logging.getLogger(__name__)

# SQLAlchemy setup  
engine = create_engine(settings.database_dsn)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
metadata = MetaData()
Base = declarative_base()

# Global database session instance for simple access
db_session: Session = None

def init_db():
    """Initialize database connection"""
    global db_session
    try:
        # Create tables
        Base.metadata.create_all(bind=engine)
        
        # Create a global session instance
        db_session = SessionLocal()
        
        logger.info("✅ Database connected successfully")
        return True
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        raise

def close_db():
    """Close database connection"""
    global db_session
    try:
        if db_session:
            db_session.close()
            db_session = None
        
        engine.dispose()
        logger.info("🔌 Database disconnected")
    except Exception as e:
        logger.error(f"❌ Error disconnecting database: {e}")

def get_db():
    """Get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_db_session():
    """Get a new database session"""
    Session = sessionmaker(bind=engine)
    session = Session()
    
    try:
        # Ensure any previous failed transactions are rolled back
        session.rollback()
        session.begin()
    except Exception:
        pass  # Ignore rollback errors if no transaction is active
    
    return session 