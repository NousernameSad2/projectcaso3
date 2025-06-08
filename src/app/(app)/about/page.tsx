import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Target, Users, Handshake } from 'lucide-react';

export default function AboutPage() {
  const teamMembers = [
    {
      name: 'Gabriel Edward Besmonte',
      role: 'Full Stack Developer',
      imageUrl: '/images/team/gab.png', 
    },
    {
      name: 'Ervin Angelo Escaño',
      role: 'Project Manager & UI/UX Designer',
      imageUrl: '/images/team/ervin.png',
    },
    {
      name: 'Joaquin Miguel G. Escueta',
      role: 'Lead Backend Developer',
      imageUrl: '/images/team/joaquin.png',
    },
    {
      name: 'Paco Flb',
      role: 'Frontend & Database Specialist',
      imageUrl: '/images/team/paco.png', 
    },
  ];

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-12 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-primary sm:text-5xl lg:text-6xl">
          About E-Bridge
        </h1>
        <p className="mt-4 max-w-2xl mx-auto text-lg text-muted-foreground">
          Connecting the UP Department of Geodetic Engineering with tomorrow&apos;s technology.
        </p>
      </header>

      <main>
        <section id="mission" className="mb-16">
          <Card className="overflow-hidden bg-background/50 backdrop-blur-lg border-border/50">
            <CardHeader className="flex flex-row items-center gap-4 bg-primary/5 p-6">
              <Target className="h-10 w-10 text-primary" />
              <div>
                <CardTitle className="text-2xl font-bold text-primary-foreground">Our Mission</CardTitle>
                <p className="text-primary/80">Why we built this platform.</p>
              </div>
            </CardHeader>
            <CardContent className="p-6 text-lg">
              <p>
                Our primary goal with E-Bridge is to empower the UP Department of Geodetic Engineering by providing a robust, centralized system for tracking and managing equipment and assets. We aim to enhance reliability, foster connectivity, and streamline resource management for students and faculty, ensuring that valuable tools are always accounted for and accessible.
              </p>
            </CardContent>
          </Card>
        </section>

        <section id="team" className="mb-16">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold tracking-tight">Meet the Team</h2>
            <p className="mt-2 text-muted-foreground">The minds behind the innovation.</p>
          </div>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {teamMembers.map((member) => (
              <Card key={member.name} className="group text-center border-border/50 hover:border-primary/50 transition-all duration-300 transform hover:-translate-y-1">
                <CardContent className="p-6">
                  <div className="relative h-32 w-32 mx-auto mb-4">
                    <Image
                      src={member.imageUrl}
                      alt={`Profile picture of ${member.name}`}
                      layout="fill"
                      objectFit="cover"
                      className="rounded-full"
                    />
                    {/* Placeholder div in case image fails to load */}
                    <div className="absolute inset-0 rounded-full bg-muted flex items-center justify-center -z-10">
                       <Users className="h-16 w-16 text-muted-foreground/30" />
                    </div>
                  </div>
                  <h3 className="text-xl font-semibold text-primary-foreground group-hover:text-primary transition-colors">{member.name}</h3>
                  <p className="text-sm text-muted-foreground">{member.role}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section id="values">
           <div className="text-center mb-10">
            <h2 className="text-3xl font-bold tracking-tight">Our Values</h2>
            <p className="mt-2 text-muted-foreground">The principles that guide our work.</p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="p-6 text-center">
              <Building2 className="h-10 w-10 mx-auto text-primary mb-3" />
              <h3 className="text-xl font-semibold">For the University</h3>
              <p className="text-muted-foreground mt-1">Built to serve the specific needs of the UP Geodetic Engineering community.</p>
            </Card>
             <Card className="p-6 text-center">
              <Handshake className="h-10 w-10 mx-auto text-primary mb-3" />
              <h3 className="text-xl font-semibold">Reliability</h3>
              <p className="text-muted-foreground mt-1">Ensuring the platform is dependable, secure, and always available.</p>
            </Card>
             <Card className="p-6 text-center">
              <Users className="h-10 w-10 mx-auto text-primary mb-3" />
              <h3 className="text-xl font-semibold">Connectivity</h3>
              <p className="text-muted-foreground mt-1">Fostering a more connected and efficient campus environment.</p>
            </Card>
          </div>
        </section>

      </main>
    </div>
  );
} 