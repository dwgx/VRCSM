#pragma once

#include "../pch.h"

class App
{
public:
    int Run(HINSTANCE hInstance, int nShowCmd);

private:
    void InitializeLogging();
};
