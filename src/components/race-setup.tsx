          <div className="grid gap-2">
            <Label htmlFor="fuelWarningThreshold">Fuel Warning Threshold (minutes)</Label>
            <Input
              id="fuelWarningThreshold"
              type="number"
              value={config.fuelWarningThresholdMinutes}
              onChange={(e) => handleConfigChange('fuelWarningThresholdMinutes', parseInt(e.target.value))}
              min="1"
            />
            <p className="text-xs text-muted-foreground">Time before fuel runs out to show warning.</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="driverCheckup">Default Driver Checkup Interval (minutes)</Label>
            <Input
              id="driverCheckup"
              type="number"
              value={config.driverCheckupMinutes || ""}
              onChange={(e) => handleConfigChange('driverCheckupMinutes', e.target.value ? parseInt(e.target.value) : undefined)}
              min="1"
              placeholder="Optional"
            />
            <p className="text-xs text-muted-foreground">Default time between driver checkups. Can be overridden per stint.</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="practiceDuration">Practice Duration (minutes)</Label>
            <Input
              id="practiceDuration"
              type="number"
              value={config.practiceDurationMinutes}
              onChange={(e) => handleConfigChange('practiceDurationMinutes', parseInt(e.target.value))}
              min="1"
            />
            <p className="text-xs text-muted-foreground">Time for practice sessions.</p>
          </div> 