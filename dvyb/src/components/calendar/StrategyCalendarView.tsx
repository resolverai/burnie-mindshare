"use client";

import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Instagram, Linkedin, Video, Image as ImageIcon, Loader2, Calendar, Sparkles } from "lucide-react";
import { contentStrategyApi, ContentStrategyItem } from "@/lib/api";
import { StrategyItemDetail } from "./StrategyItemDetail";
import { trackStrategyCalendarViewed, trackStrategyItemClicked, trackStrategyItemDeleted, trackStrategyMonthChanged } from "@/lib/mixpanel";

// Platform icons
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className || "w-4 h-4"} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className || "w-4 h-4"} fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
  </svg>
);

const getPlatformIcon = (platform: string, className?: string) => {
  switch (platform.toLowerCase()) {
    case 'instagram':
      return <Instagram className={className || "w-4 h-4"} />;
    case 'twitter':
      return <XIcon className={className} />;
    case 'linkedin':
      return <Linkedin className={className || "w-4 h-4"} />;
    case 'tiktok':
      return <TikTokIcon className={className} />;
    default:
      return <Calendar className={className || "w-4 h-4"} />;
  }
};

const getPlatformColor = (platform: string) => {
  switch (platform.toLowerCase()) {
    case 'instagram':
      return 'bg-gradient-to-r from-purple-500 to-pink-500';
    case 'twitter':
      return 'bg-black';
    case 'linkedin':
      return 'bg-blue-600';
    case 'tiktok':
      return 'bg-black';
    default:
      return 'bg-gray-500';
  }
};

interface DayContent {
  date: string;
  dayOfWeek: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  items: ContentStrategyItem[];
}

export function StrategyCalendarView() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [items, setItems] = useState<ContentStrategyItem[]>([]);
  const [weekThemes, setWeekThemes] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ContentStrategyItem | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [availableMonths, setAvailableMonths] = useState<Set<string>>(new Set());
  const hasTrackedInitialView = useRef(false);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayNamesShort = ["S", "M", "T", "W", "T", "F", "S"];

  const fetchAvailableMonths = async () => {
    try {
      const response = await contentStrategyApi.getAvailableMonths();
      if (response.success) {
        setAvailableMonths(new Set(response.data.months));
      }
    } catch (error) {
      console.error('Failed to fetch available months:', error);
    }
  };

  const fetchStrategy = async () => {
    setLoading(true);
    try {
      const monthStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      const response = await contentStrategyApi.getCalendar(monthStr);
      if (response.success) {
        setItems(response.data.items);
        setWeekThemes(response.data.weekThemes);
      }
    } catch (error) {
      console.error('Failed to fetch strategy:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch available months on mount
  useEffect(() => {
    fetchAvailableMonths();
  }, []);

  useEffect(() => {
    fetchStrategy();
    
    // Track calendar view
    const monthStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    if (!hasTrackedInitialView.current) {
      trackStrategyCalendarViewed(monthStr);
      hasTrackedInitialView.current = true;
    }
  }, [currentMonth]);

  // Check if navigation is allowed
  const currentMonthStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
  const sortedMonths = Array.from(availableMonths).sort();
  const minMonth = sortedMonths[0];
  const maxMonth = sortedMonths[sortedMonths.length - 1];
  
  const canGoPrev = minMonth && currentMonthStr > minMonth;
  const canGoNext = maxMonth && currentMonthStr < maxMonth;

  const handlePrevMonth = () => {
    const prevMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    const fromMonth = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    const toMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
    trackStrategyMonthChanged({ fromMonth, toMonth, direction: 'prev' });
    setCurrentMonth(prevMonth);
  };

  const handleNextMonth = () => {
    const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    const fromMonth = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    const toMonth = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
    trackStrategyMonthChanged({ fromMonth, toMonth, direction: 'next' });
    setCurrentMonth(nextMonth);
  };

  const handleItemClick = (item: ContentStrategyItem) => {
    trackStrategyItemClicked({
      itemId: item.id,
      platform: item.platform,
      contentType: item.contentType,
      date: item.date,
    });
    setSelectedItem(item);
    setShowDetail(true);
  };

  const handleDelete = async (itemId: number) => {
    try {
      const item = items.find(i => i.id === itemId);
      await contentStrategyApi.deleteItem(itemId);
      if (item) {
        trackStrategyItemDeleted({
          itemId,
          platform: item.platform,
          date: item.date,
        });
      }
      setItems(prev => prev.filter(item => item.id !== itemId));
      setShowDetail(false);
      setSelectedItem(null);
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  // Generate calendar days
  const generateCalendarDays = (): DayContent[] => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startingDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    const days: DayContent[] = [];
    
    // Previous month days
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const dayNumber = prevMonthLastDay - i;
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
      days.push({
        date: dateStr,
        dayOfWeek: dayNames[(startingDayOfWeek - i - 1 + 7) % 7],
        dayNumber,
        isCurrentMonth: false,
        isToday: false,
        items: [],
      });
    }
    
    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayItems = items.filter(item => item.date === dateStr);
      
      days.push({
        date: dateStr,
        dayOfWeek: dayNames[new Date(year, month, day).getDay()],
        dayNumber: day,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        items: dayItems,
      });
    }
    
    // Next month days (fill to 42 for 6 rows)
    const remainingDays = 42 - days.length;
    for (let day = 1; day <= remainingDays; day++) {
      const dateStr = `${year}-${String(month + 2).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        date: dateStr,
        dayOfWeek: dayNames[(startingDayOfWeek + daysInMonth + day - 1) % 7],
        dayNumber: day,
        isCurrentMonth: false,
        isToday: false,
        items: [],
      });
    }
    
    return days;
  };

  const calendarDays = generateCalendarDays();

  // Get current week's theme
  const getCurrentWeekTheme = () => {
    const today = new Date();
    const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const weekOfMonth = Math.ceil((today.getDate() + startOfMonth.getDay()) / 7);
    return weekThemes[weekOfMonth] || null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your content strategy...</p>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center px-4">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Sparkles className="w-10 h-10 text-primary" />
        </div>
        <h3 className="text-xl font-semibold mb-2">No Content Strategy Yet</h3>
        <p className="text-muted-foreground max-w-md mb-6">
          Generate content to create your personalized content strategy. 
          We'll ask you a few questions to understand your goals and create a 4-week content plan.
        </p>
        <Badge variant="secondary" className="text-sm">
          Strategy is created during content generation
        </Badge>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-4">
          <Button 
            variant="outline" 
            size="icon" 
            onClick={handlePrevMonth}
            disabled={!canGoPrev}
            className={`h-8 w-8 sm:h-10 sm:w-10 ${!canGoPrev ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <h2 className="text-lg sm:text-xl font-semibold min-w-[140px] sm:min-w-[180px] text-center">
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </h2>
          <Button 
            variant="outline" 
            size="icon" 
            onClick={handleNextMonth}
            disabled={!canGoNext}
            className={`h-8 w-8 sm:h-10 sm:w-10 ${!canGoNext ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        
        {getCurrentWeekTheme() && (
          <Badge className="bg-primary/10 text-primary border-primary/20 text-xs sm:text-sm">
            This Week: {getCurrentWeekTheme()}
          </Badge>
        )}
      </div>

      {/* Week themes legend - scrollable on mobile */}
      {Object.keys(weekThemes).length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
          {Object.entries(weekThemes).map(([week, theme]) => (
            <Badge key={week} variant="outline" className="text-xs whitespace-nowrap flex-shrink-0">
              Week {week}: {theme}
            </Badge>
          ))}
        </div>
      )}

      {/* Calendar Grid */}
      <Card className="overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b">
          {dayNames.map((day, idx) => (
            <div key={day} className="p-1 sm:p-2 text-center text-xs sm:text-sm font-medium text-muted-foreground border-r last:border-r-0">
              <span className="hidden sm:inline">{day}</span>
              <span className="sm:hidden">{dayNamesShort[idx]}</span>
            </div>
          ))}
        </div>

        {/* Calendar days */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day, index) => (
            <div
              key={`${day.date}-${index}`}
              className={`min-h-[60px] sm:min-h-[100px] md:min-h-[120px] p-1 sm:p-2 border-r border-b last:border-r-0 ${
                !day.isCurrentMonth ? 'bg-muted/30' : ''
              } ${day.isToday ? 'bg-primary/5' : ''}`}
            >
              {/* Day number */}
              <div className={`text-xs sm:text-sm font-medium mb-1 sm:mb-2 ${
                !day.isCurrentMonth ? 'text-muted-foreground/50' : ''
              } ${day.isToday ? 'text-primary' : ''}`}>
                {day.dayNumber}
                {day.isToday && (
                  <span className="hidden sm:inline ml-1 text-xs text-primary">Today</span>
                )}
              </div>

              {/* Content items - desktop view */}
              <div className="hidden sm:block space-y-1">
                {day.items.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    className="group cursor-pointer"
                    onClick={() => handleItemClick(item)}
                  >
                    <div className={`flex items-center gap-1.5 p-1.5 rounded text-xs text-white ${getPlatformColor(item.platform)} hover:opacity-90 transition-opacity`}>
                      {getPlatformIcon(item.platform, "w-3 h-3")}
                      <span className="truncate flex-1">{item.topic}</span>
                      {item.contentType === 'video' ? (
                        <Video className="w-3 h-3 flex-shrink-0" />
                      ) : (
                        <ImageIcon className="w-3 h-3 flex-shrink-0" />
                      )}
                    </div>
                  </div>
                ))}
                {day.items.length > 3 && (
                  <div className="text-xs text-muted-foreground text-center">
                    +{day.items.length - 3} more
                  </div>
                )}
              </div>

              {/* Content items - mobile view (dots only) */}
              <div className="sm:hidden flex flex-wrap gap-0.5 justify-center">
                {day.items.slice(0, 4).map((item) => (
                  <div
                    key={item.id}
                    className={`w-2 h-2 rounded-full cursor-pointer ${getPlatformColor(item.platform)}`}
                    onClick={() => handleItemClick(item)}
                  />
                ))}
                {day.items.length > 4 && (
                  <div className="text-[8px] text-muted-foreground">+{day.items.length - 4}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Mobile: List view of items for current month */}
      <div className="sm:hidden space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Posts this month ({items.length})
        </h3>
        {items.slice(0, 10).map((item) => (
          <Card
            key={item.id}
            className="p-3 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => handleItemClick(item)}
          >
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white ${getPlatformColor(item.platform)}`}>
                {getPlatformIcon(item.platform, "w-4 h-4")}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.topic}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>{new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <span>•</span>
                  <span className="capitalize">{item.contentType}</span>
                </div>
              </div>
              {item.contentType === 'video' ? (
                <Video className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <ImageIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
            </div>
          </Card>
        ))}
        {items.length > 10 && (
          <p className="text-xs text-muted-foreground text-center">
            Tap on calendar dots to see more posts
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 sm:gap-4">
        <Card className="p-2 sm:p-4">
          <div className="text-lg sm:text-2xl font-bold text-primary">{items.length}</div>
          <div className="text-xs sm:text-sm text-muted-foreground">Total</div>
        </Card>
        <Card className="p-2 sm:p-4">
          <div className="text-lg sm:text-2xl font-bold text-pink-500">
            {items.filter(i => i.platform === 'instagram').length}
          </div>
          <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1">
            <Instagram className="w-3 h-3 sm:hidden" />
            <span className="hidden sm:inline">Instagram</span>
          </div>
        </Card>
        <Card className="p-2 sm:p-4">
          <div className="text-lg sm:text-2xl font-bold text-black dark:text-white">
            {items.filter(i => i.platform === 'twitter').length}
          </div>
          <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1">
            <XIcon className="w-3 h-3 sm:hidden" />
            <span className="hidden sm:inline">X / Twitter</span>
          </div>
        </Card>
        <Card className="p-2 sm:p-4">
          <div className="text-lg sm:text-2xl font-bold text-blue-600">
            {items.filter(i => i.platform === 'linkedin').length}
          </div>
          <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1">
            <Linkedin className="w-3 h-3 sm:hidden" />
            <span className="hidden sm:inline">LinkedIn</span>
          </div>
        </Card>
      </div>

      {/* Item Detail Dialog */}
      <StrategyItemDetail
        item={selectedItem}
        open={showDetail}
        onOpenChange={setShowDetail}
        onDelete={handleDelete}
      />
    </div>
  );
}

