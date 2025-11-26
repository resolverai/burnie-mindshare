"use client";


import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Clock } from "lucide-react";
import { format } from "date-fns";

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: any;
  onScheduleComplete: () => void;
}

// Mock scheduled posts
const scheduledPosts = [
  { date: new Date(2024, 10, 13), time: "15:00", title: "Turn humor into your fastest growth hack" },
  { date: new Date(2024, 10, 14), time: "15:00", title: "Create viral AI-made videos" },
  { date: new Date(2024, 10, 15), time: "12:00", title: "Decentralized content" },
  { date: new Date(2024, 10, 16), time: "09:00", title: "Power to creators" },
];

export const ScheduleDialog = ({ open, onOpenChange, post, onScheduleComplete }: ScheduleDialogProps) => {
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTime, setSelectedTime] = useState("12:00");
  const [showOverlapDialog, setShowOverlapDialog] = useState(false);
  const [conflictingPost, setConflictingPost] = useState<any>(null);

  const checkForOverlap = (date: Date, time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    const scheduledDateTime = new Date(date);
    scheduledDateTime.setHours(hours, minutes, 0, 0);

    for (const scheduled of scheduledPosts) {
      const [schedHours, schedMinutes] = scheduled.time.split(":").map(Number);
      const existingDateTime = new Date(scheduled.date);
      existingDateTime.setHours(schedHours, schedMinutes, 0, 0);

      const diffInMinutes = Math.abs((scheduledDateTime.getTime() - existingDateTime.getTime()) / (1000 * 60));

      if (diffInMinutes < 120) {
        return scheduled;
      }
    }
    return null;
  };

  const handleSchedule = () => {
    if (!selectedDate) return;

    const conflict = checkForOverlap(selectedDate, selectedTime);
    if (conflict) {
      setConflictingPost(conflict);
      setShowOverlapDialog(true);
    } else {
      onScheduleComplete();
      onOpenChange(false);
    }
  };

  const handleReplacePost = () => {
    setShowOverlapDialog(false);
    onScheduleComplete();
    onOpenChange(false);
  };

  const handleChangeTime = () => {
    setShowOverlapDialog(false);
  };

  const getPostsForDate = (date: Date) => {
    return scheduledPosts.filter(
      (post) => post.date.toDateString() === date.toDateString()
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schedule Post</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-6 py-4">
            {/* Calendar Section */}
            <div className="space-y-4">
              <div>
                <Label>Select Date</Label>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  className="rounded-md border"
                  modifiers={{
                    scheduled: scheduledPosts.map(p => p.date)
                  }}
                  modifiersStyles={{
                    scheduled: {
                      fontWeight: 'bold',
                      backgroundColor: 'hsl(var(--primary) / 0.1)',
                    }
                  }}
                />
              </div>

              <div>
                <Label htmlFor="time">Select Time</Label>
                <div className="relative mt-2">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="time"
                    type="time"
                    value={selectedTime}
                    onChange={(e) => setSelectedTime(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>

            {/* Scheduled Posts Section */}
            <div className="space-y-4">
              <div>
                <Label>Scheduled Posts</Label>
                {selectedDate ? (
                  <div className="mt-2 space-y-2">
                    {getPostsForDate(selectedDate).length > 0 ? (
                      getPostsForDate(selectedDate).map((post, idx) => (
                        <Card key={idx} className="p-3">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{post.time}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {post.title}
                          </p>
                        </Card>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground py-4">
                        No posts scheduled for this date
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">
                    Select a date to see scheduled posts
                  </p>
                )}
              </div>

              {/* Post Preview */}
              {post && (
                <div>
                  <Label>Post Preview</Label>
                  <Card className="mt-2 overflow-hidden">
                    <img
                      src={post.image}
                      alt={post.title}
                      className="w-full aspect-video object-cover"
                    />
                    <div className="p-3">
                      <p className="font-medium text-sm">{post.title}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {post.description}
                      </p>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              onClick={handleSchedule}
              disabled={!selectedDate}
            >
              Schedule Post
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showOverlapDialog} onOpenChange={setShowOverlapDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post Time Conflict</AlertDialogTitle>
            <AlertDialogDescription>
              There is already a post scheduled within 2 hours of your selected time ({selectedTime}).
              <br />
              <br />
              <strong>Conflicting post:</strong> {conflictingPost?.title} at {conflictingPost?.time}
              <br />
              <br />
              Would you like to replace the existing post or change your timing?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={handleChangeTime}>
              Change Time
            </Button>
            <Button onClick={handleReplacePost} className="bg-blue-600 hover:bg-blue-700">
              Replace Post
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
