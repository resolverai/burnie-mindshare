"use client";


import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Edit, Eye, FileText } from "lucide-react";

export const BrandPlan = () => {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-foreground mb-8">Brand Plan</h1>

        {/* Weekly Plan Timeline */}
        <div className="relative">
          {/* Timeline Line */}
          <div className="absolute left-[15px] top-8 bottom-0 w-0.5 bg-border" />

          {/* Next Week Card */}
          <Card className="mb-6 p-6 border border-border relative">
            <div className="flex items-start gap-6">
              {/* Timeline Dot */}
              <div className="relative z-10 w-8 h-8 rounded-full bg-primary border-4 border-background flex-shrink-0" />

              <div className="flex-1 grid grid-cols-3 gap-6">
                {/* Week Info */}
                <div>
                  <p className="text-xs text-primary font-medium mb-1">Next Week</p>
                  <h3 className="text-xl font-semibold text-foreground mb-2">Nov 20 - 26</h3>
                  <Badge className="bg-primary/10 text-primary border-0">Planned</Badge>
                </div>

                {/* Post Schedule */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Post Schedule</p>
                  <p className="text-sm font-medium text-foreground mb-3">Everyday</p>
                  <Button variant="link" className="text-primary p-0 h-auto gap-1">
                    <Edit className="w-3 h-3" />
                    Edit
                  </Button>
                </div>

                {/* Generating Info */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Generating on</p>
                  <p className="text-sm font-medium text-foreground mb-3">Mon, Nov 17</p>
                  <Button variant="link" className="text-primary p-0 h-auto gap-1">
                    <Edit className="w-3 h-3" />
                    Edit Topics
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* Current Week Card */}
          <Card className="mb-6 p-6 border border-border relative">
            <div className="flex items-start gap-6">
              {/* Timeline Dot */}
              <div className="relative z-10 w-8 h-8 rounded-full bg-green-500 border-4 border-background flex-shrink-0" />

              <div className="flex-1 grid grid-cols-3 gap-6">
                {/* Week Info */}
                <div>
                  <p className="text-xs text-green-600 font-medium mb-1">Current Week</p>
                  <h3 className="text-xl font-semibold text-foreground mb-2">Nov 13 - 19</h3>
                  <Badge className="bg-green-100 text-green-700 border-0">Publishing</Badge>
                </div>

                {/* Post Schedule */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Post Schedule</p>
                  <p className="text-sm font-medium text-foreground mb-3">Everyday</p>
                  <Button variant="link" className="text-primary p-0 h-auto gap-1">
                    <Eye className="w-3 h-3" />
                    View Topics
                  </Button>
                </div>

                {/* Content Generated Info */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Content Generated</p>
                  <p className="text-sm font-medium text-foreground mb-3">Tue, Nov 11</p>
                  <Button variant="link" className="text-primary p-0 h-auto gap-1">
                    <FileText className="w-3 h-3" />
                    See Content
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* Past Weeks Placeholder */}
          <div className="flex items-start gap-6 pl-14">
            <p className="text-sm text-muted-foreground">Past weeks will appear down here</p>
          </div>
        </div>
      </div>
    </div>
  );
};
